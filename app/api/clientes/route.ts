import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSheetData, appendRow, getNextId, ensureColumns } from '@/lib/datastore'
import { ajustarStockAdicionales } from '@/lib/stock'
import { gredaEsperada, aplicarCambioGreda, SIN_GREDA } from '@/lib/greda-stock'
import { generarCodigo } from '@/lib/codigo-generator'
import { enviarRegistroMascota, resumenCompraDeFicha } from '@/lib/cliente-mailer'
import { resolverVet, enviarCodigoVet } from '@/lib/vet-cremacion-mailer'
import { todayISO } from '@/lib/dates'
import { calcularSnapshotFicha, type AdicionalItem } from '@/lib/price-calculator'
import { capitalizarNombre } from '@/lib/nombres'
import { sincronizarSaldoParcial } from '@/lib/cobros'

const ClienteSchema = z.object({
  nombre_mascota: z.string().min(1, 'Nombre de mascota requerido'),
  nombre_tutor: z.string().min(1, 'Nombre de tutor requerido'),
  email: z.string().email('Email inválido'),
  telefono: z.string().regex(/^\d{9}$/, 'Teléfono debe tener exactamente 9 dígitos'),
  direccion_retiro: z.string().min(1, 'Dirección de retiro requerida'),
  direccion_despacho: z.string().min(1, 'Dirección de despacho requerida'),
  misma_direccion: z.boolean(),
  comuna: z.string().min(1, 'Comuna requerida'),
  fecha_retiro: z.string().min(1, 'Fecha de retiro requerida'),
  hora_retiro: z.string().optional(),
  fecha_defuncion: z.string().min(1, 'Fecha de defunción requerida'),
  especie: z.string().min(1, 'Especie requerida'),
  letra_especie: z.string().length(1),
  peso_declarado: z.number().positive(),
  peso_ingreso: z.number().positive().optional(),
  tipo_servicio: z.string().min(1, 'Servicio requerido'),
  codigo_servicio: z.enum(['CI', 'CP', 'SD']),
  tipo_pago: z.string().min(1, 'Tipo de pago requerido'),
  estado_pago: z.string().min(1, 'Estado de pago requerido'),
  veterinaria_id: z.string().optional(),
  adicionales: z.string().optional(),
  descuento_id: z.string().optional(),
  descuento_nombre: z.string().optional(),
  descuento_tipo: z.string().optional(),
  descuento_valor: z.union([z.number(), z.string()]).optional(),
  descuento_monto: z.union([z.number(), z.string()]).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const estado = searchParams.get('estado')
    const buscar = searchParams.get('buscar')
    let rows = await getSheetData('clientes')
    if (estado) rows = rows.filter((r) => r.estado === estado)
    if (buscar) {
      const q = buscar.toLowerCase()
      rows = rows.filter(
        (r) =>
          r.nombre_mascota?.toLowerCase().includes(q) ||
          r.nombre_tutor?.toLowerCase().includes(q) ||
          r.codigo?.toLowerCase().includes(q)
      )
    }

    // eutanasia_valor (NO persistido): valor a cobrar de la eutanasia a domicilio
    // asociada a la ficha, para que el resumen de la lista muestre el total real
    // a cobrar. Fuera de boleta (esa sigue solo por precio_total). Best-effort.
    try {
      const cotis = await getSheetData('cotizaciones_eutanasia')
      const activas = cotis.filter(c => c.cliente_id && !['cancelada', 'no_realizada'].includes(String(c.estado || '')))
      if (activas.length) {
        const { valorClienteCotizacion } = await import('@/lib/eutanasia-precios')
        const valores = new Map<string, number>()
        for (const cot of activas) {
          valores.set(String(cot.cliente_id), await valorClienteCotizacion(cot))
        }
        rows = rows.map(r => {
          const v = valores.get(String(r.id))
          return v && v > 0 ? { ...r, eutanasia_valor: String(v) } : r
        })
      }
    } catch { /* la lista sale igual, sin la línea de eutanasia */ }

    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = ClienteSchema.parse(body)
    // Nombres siempre en Tipo Título (se usan tal cual en correos/certificados).
    data.nombre_mascota = capitalizarNombre(data.nombre_mascota)
    data.nombre_tutor = capitalizarNombre(data.nombre_tutor)
    await ensureColumns('clientes', [
      'email', 'telefono',
      'veterinaria_id', 'adicionales', 'tipo_precios',
      'peso_declarado', 'peso_ingreso', 'despacho_id',
      'descuento_id', 'descuento_nombre', 'descuento_tipo', 'descuento_valor', 'descuento_monto',
      'fecha_defuncion', 'notas', 'tipo_pago', 'estado_pago',
      'precio_servicio', 'precio_adicionales', 'precio_total', 'hora_retiro',
      'greda_descontada',
    ])
    const codigo = await generarCodigo(data.letra_especie, data.codigo_servicio)
    const id = await getNextId('clientes')
    const now = todayISO()

    // Snapshot del precio al momento de crear la ficha. Lee la tabla de precios
    // vigente y "congela" el monto en columnas dedicadas; los cambios posteriores
    // en Configuración → Precios NO afectan a esta ficha. Solo entrar a la ficha
    // individual y guardar reescribe el snapshot.
    let parsedAdicionales: AdicionalItem[] = []
    try { parsedAdicionales = JSON.parse(data.adicionales ?? '[]') } catch { parsedAdicionales = [] }
    const snapshot = await calcularSnapshotFicha({
      peso: data.peso_ingreso || data.peso_declarado,
      codigo_servicio: data.codigo_servicio,
      veterinaria_id: data.veterinaria_id,
      adicionales: parsedAdicionales,
      descuento_tipo: data.descuento_tipo,
      descuento_valor: data.descuento_valor as number | string | undefined,
    })

    // PAGO PARCIAL en el alta: el tutor abonó una parte; el resto queda como saldo
    // pendiente (cobro 'saldo'). Si el abono cubre el total, la ficha nace 'pagado'.
    // `monto_abonado` no es columna de clientes: solo sirve para calcular el saldo.
    let estadoPagoFinal = data.estado_pago
    let pendienteParcial = 0
    if (String(data.estado_pago).toLowerCase() === 'parcial') {
      const totalFicha = Number(snapshot.precio_total) || 0
      const abono = Math.round(parseFloat(String((body as { monto_abonado?: unknown }).monto_abonado ?? '')) || 0)
      pendienteParcial = Math.round(totalFicha - abono)
      if (pendienteParcial <= 0) estadoPagoFinal = 'pagado' // el abono cubre el total → pagado
    }

    const row = {
      id,
      codigo,
      nombre_mascota: data.nombre_mascota,
      nombre_tutor: data.nombre_tutor,
      email: data.email,
      telefono: data.telefono,
      direccion_retiro: data.direccion_retiro,
      direccion_despacho: data.misma_direccion ? data.direccion_retiro : data.direccion_despacho,
      misma_direccion: data.misma_direccion ? 'TRUE' : 'FALSE',
      comuna: data.comuna,
      fecha_retiro: data.fecha_retiro,
      hora_retiro: data.hora_retiro ?? '',
      fecha_defuncion: data.fecha_defuncion,
      especie: data.especie,
      letra_especie: data.letra_especie,
      peso_declarado: data.peso_declarado,
      peso_ingreso: data.peso_ingreso !== undefined ? data.peso_ingreso : '',
      tipo_servicio: data.tipo_servicio,
      codigo_servicio: data.codigo_servicio,
      estado: 'pendiente',
      ciclo_id: '',
      despacho_id: '',
      veterinaria_id: data.veterinaria_id ?? '',
      tipo_precios: snapshot.tipo_precios_efectivo,
      adicionales: data.adicionales ?? '[]',
      descuento_id: data.descuento_id ?? '',
      descuento_nombre: data.descuento_nombre ?? '',
      descuento_tipo: data.descuento_tipo ?? '',
      descuento_valor: data.descuento_valor !== undefined ? String(data.descuento_valor) : '',
      descuento_monto: String(snapshot.descuento_monto),
      precio_servicio: snapshot.precio_servicio,
      precio_adicionales: snapshot.precio_adicionales,
      precio_total: snapshot.precio_total,
      tipo_pago: data.tipo_pago,
      estado_pago: estadoPagoFinal,
      fecha_creacion: now,
      greda_descontada: SIN_GREDA, // se resuelve tras el insert (abajo)
    }

    // Greda incluida (solo CI): resolver el producto por tramo de peso ANTES del
    // insert para persistir qué unidad consume esta ficha (lib/greda-stock.ts).
    let gredaFicha = SIN_GREDA
    try { gredaFicha = await gredaEsperada(row) } catch (e) { console.warn('[clientes POST] greda no resuelta:', e) }
    row.greda_descontada = gredaFicha

    await appendRow('clientes', row)

    // Descontar stock (best-effort, no bloquea la creación): la greda del tramo
    // + los productos adicionales elegidos al crear (ánfora premium, relicarios…).
    // Antes este descuento solo existía al EDITAR la ficha (PATCH) — los
    // adicionales seleccionados en el alta nunca descontaban.
    try { await aplicarCambioGreda(SIN_GREDA, gredaFicha) } catch (e) { console.warn('[clientes POST] stock greda:', e) }
    try { await ajustarStockAdicionales([], parsedAdicionales) } catch (e) { console.warn('[clientes POST] stock adicionales:', e) }

    // Saldo del pago parcial → cobro 'saldo' (banner + notificación "pago pendiente").
    if (estadoPagoFinal === 'parcial' && pendienteParcial > 0) {
      try { await sincronizarSaldoParcial(String(id), pendienteParcial) }
      catch (e) { console.warn('[clientes POST] no se pudo crear el saldo parcial:', e) }
    }

    // Mail de bienvenida al tutor con el código de su mascota (best-effort:
    // no bloquea la creación de la ficha si Resend falla o no está configurado).
    try {
      await enviarRegistroMascota({
        email: row.email,
        nombreMascota: row.nombre_mascota,
        nombreTutor: row.nombre_tutor,
        codigo: row.codigo,
        clienteId: String(id),
        codigoServicio: String(row.codigo_servicio || ''),
        resumen: (await resumenCompraDeFicha(row).catch(() => null)) ?? undefined,
      })
    } catch (e) {
      console.warn('[clientes POST] fallo mail registro (no bloqueante):', e)
    }

    // Si la ficha está asociada a un veterinario de convenio, también le avisamos
    // a él con el código (best-effort, no bloqueante).
    try {
      const vet = await resolverVet(row.veterinaria_id)
      if (vet) await enviarCodigoVet({ ...vet, nombreMascota: row.nombre_mascota, codigo: row.codigo })
    } catch (e) {
      console.warn('[clientes POST] fallo mail código al vet (no bloqueante):', e)
    }

    return NextResponse.json({ ...row }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
