import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateById, ensureColumns, deleteRow } from '@/lib/datastore'
import { ajustarStock, ajustarStockAdicionales } from '@/lib/stock'
import { gredaEsperada, aplicarCambioGreda } from '@/lib/greda-stock'
import { parseDecimal } from '@/lib/numbers'
import { calcularSnapshotFicha, type AdicionalItem as PCAdicionalItem } from '@/lib/price-calculator'
import { generarCodigo } from '@/lib/codigo-generator'
import { enviarRegistroMascota, resumenCompraDeFicha } from '@/lib/cliente-mailer'
import { capitalizarNombre } from '@/lib/nombres'
import { esAdmin } from '@/lib/roles'
import { NOMBRE_SERVICIO } from '@/lib/cliente-borrador'
import { dispararCobroAdicional, cobrosPendientesPorCliente, sincronizarSaldoParcial, cerrarSaldoParcial } from '@/lib/cobros'
import { excluirIncluidos } from '@/lib/anforas-premium'
import { emitirBoletaSiCorresponde } from '@/lib/facturacion'
import { desgloseValorCotizacion, valorEutanasiaPorCliente } from '@/lib/eutanasia-precios'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const rows = await getSheetData('clientes')
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const cliente = rows[idx]

    let ciclo = null
    if (cliente.ciclo_id) {
      const ciclos = await getSheetData('ciclos')
      ciclo = ciclos.find((c) => c.id === cliente.ciclo_id) ?? null
    }

    let despacho = null
    if (cliente.despacho_id) {
      const despachos = await getSheetData('despachos')
      despacho = despachos.find((d) => d.id === cliente.despacho_id) ?? null
    }

    // Cobros pendientes (adicional / diferencia) → banner "cobro pendiente".
    const cobros = await cobrosPendientesPorCliente(id).catch(() => [])

    // Eutanasia asociada (si la ficha vino de una eutanasia a domicilio): para
    // mostrar "Hora Vet" / "Hora Retiro" y el VALOR a cobrar por la eutanasia,
    // que se cobra aparte y NO entra en la boleta (esa es solo por la cremación).
    let eutanasia = null
    try {
      const cotis = await getSheetData('cotizaciones_eutanasia')
      const cot = cotis.find((c) => String(c.cliente_id) === String(id) && (c.estado || '') !== 'cancelada')
      if (cot) {
        let base = 0, recargo = 0, valorCliente = 0
        try {
          const d = await desgloseValorCotizacion(cot)
          base = d.base; recargo = d.recargo; valorCliente = d.total
        } catch { /* config no disponible */ }
        eutanasia = {
          id: cot.id || '',
          hora_servicio: cot.hora_servicio || '',
          hora_retiro_crematorio: cot.hora_retiro_crematorio || '',
          estado: cot.estado || '',
          valor_cliente: valorCliente,
          // Desglose: base del servicio + recargo fuera de horario (0 si no aplica),
          // para mostrarlos separados en la ficha.
          valor_base: base,
          recargo_fuera_horario: recargo,
        }
      }
    } catch { /* best-effort: la ficha se muestra igual sin datos de eutanasia */ }

    return NextResponse.json({ ...cliente, ciclo, despacho, cobros, eutanasia })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()

    await ensureColumns('clientes', [
      'veterinaria_id', 'adicionales', 'tipo_precios',
      'descuento_id', 'descuento_nombre', 'descuento_tipo', 'descuento_valor', 'descuento_monto',
      'fecha_defuncion', 'notas', 'tipo_pago', 'estado_pago',
      'peso_declarado', 'peso_ingreso', 'despacho_id',
      'precio_servicio', 'precio_adicionales', 'precio_total', 'boleta_id', 'hora_retiro',
      'greda_descontada',
    ])

    const rows = await getSheetData('clientes')
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    // Adjust product stock when adicionales change
    if (body.adicionales !== undefined) {
      const oldAdicionales = parseAdicionales(rows[idx].adicionales)
      const newAdicionales = parseAdicionales(body.adicionales)
      await ajustarStockAdicionales(oldAdicionales, newAdicionales)
    }

    // Normalizar pesos: aceptar coma decimal y guardar como number
    const normalizedBody = { ...body }
    // CAMPOS DE SISTEMA: los administran flujos propios (registrar, uploads de
    // fotos/videos, ciclos, despachos, cobro-diferencia) — se ELIMINAN del body
    // para que un "Guardar" de la ficha con el form desactualizado no los pise.
    // Bug real (2026-07-04): el form guardaba codigo:'' + estado:'borrador'
    // capturados al abrir la página → un Guardar posterior al "Registrar ficha"
    // revertía la ficha a borrador → se re-registraba con el MISMO código y el
    // correo de bienvenida salía 2-3 veces al tutor.
    const CAMPOS_SISTEMA = [
      'id', 'codigo', 'estado', 'ciclo_id', 'despacho_id', 'origen', 'fecha_creacion',
      'fotos_mascota', 'fotos_cuadro', 'videos_servicio', 'fotos_evidencia',
      'correo_diferencia_fecha', 'correo_diferencia_monto',
      'greda_descontada', // lo administra el sync de greda de abajo, nunca el form
    ]
    for (const k of CAMPOS_SISTEMA) delete normalizedBody[k]
    for (const k of ['peso_declarado', 'peso_ingreso']) {
      if (normalizedBody[k] !== undefined && normalizedBody[k] !== '') {
        const n = parseDecimal(normalizedBody[k])
        if (n !== null) normalizedBody[k] = n
      }
    }
    // Normalizar teléfono: solo dígitos, máximo 9
    if (typeof normalizedBody.telefono === 'string') {
      normalizedBody.telefono = normalizedBody.telefono.replace(/\D/g, '').slice(-9)
    }
    // Nombres en Tipo Título (se usan tal cual en correos/certificados).
    for (const k of ['nombre_mascota', 'nombre_tutor']) {
      if (typeof normalizedBody[k] === 'string') normalizedBody[k] = capitalizarNombre(normalizedBody[k])
    }

    const candidate = { ...rows[idx], ...normalizedBody }

    // Recalcular snapshot del precio con los valores finales (post-merge).
    // Este es el único punto donde se reescribe: edición explícita de la ficha.
    // Cambios en tablas de precio nunca alcanzan acá.
    const pesoSnapshot = parseDecimal(String(candidate.peso_ingreso ?? '')) ?? parseDecimal(String(candidate.peso_declarado ?? '')) ?? 0
    const codigoServSnap = String(candidate.codigo_servicio ?? 'CI')
    let adicionalesSnap: PCAdicionalItem[] = []
    try { adicionalesSnap = JSON.parse(String(candidate.adicionales ?? '[]')) } catch { adicionalesSnap = [] }
    const snapshot = await calcularSnapshotFicha({
      peso: pesoSnapshot,
      codigo_servicio: codigoServSnap,
      veterinaria_id: candidate.veterinaria_id ? String(candidate.veterinaria_id) : undefined,
      tipo_precios: candidate.tipo_precios ? String(candidate.tipo_precios) : undefined,
      adicionales: adicionalesSnap,
      descuento_tipo: candidate.descuento_tipo ? String(candidate.descuento_tipo) : undefined,
      descuento_valor: candidate.descuento_valor as number | string | undefined,
    })

    const updated = {
      ...candidate,
      tipo_precios: snapshot.tipo_precios_efectivo,
      precio_servicio: snapshot.precio_servicio,
      precio_adicionales: snapshot.precio_adicionales,
      precio_total: snapshot.precio_total,
      descuento_monto: String(snapshot.descuento_monto),
    }

    // Mantener tipo_servicio (nombre legible) sincronizado con codigo_servicio.
    // Antes quedaba desincronizado (o con el código corto 'CI' que escribía el
    // borrador del bot) y la ficha mostraba "Cremación ()" — caso Princesa.
    const nombreServicio = NOMBRE_SERVICIO[String(candidate.codigo_servicio || '').toUpperCase()]
    if (nombreServicio) updated.tipo_servicio = nombreServicio

    // PAGO PARCIAL: el tutor abonó una parte y queda un saldo por pagar. El monto
    // abonado llega en `body.monto_abonado` (no se persiste en la ficha: el
    // pendiente se lleva como un cobro 'saldo'). Si el abono cubre el total, la
    // ficha queda 'pagado' y cae al flujo normal de boleta. `monto_abonado` NO es
    // columna de `clientes` → rowForWrite lo descarta en el write (a propósito).
    // El TOTAL A COBRAR incluye la eutanasia a domicilio asociada (se cobra junto
    // al retiro, aunque va FUERA de la boleta — esa sigue solo por precio_total).
    const eutanasiaFicha = await valorEutanasiaPorCliente(id).catch(() => 0)
    const totalFicha = (parseDecimal(String(updated.precio_total ?? '')) ?? 0) + eutanasiaFicha
    const abonoParcial = parseDecimal(String(body.monto_abonado ?? '')) ?? 0
    let pendienteParcial = 0
    if (String(updated.estado_pago || '').toLowerCase() === 'parcial') {
      pendienteParcial = Math.round(totalFicha - abonoParcial)
      if (pendienteParcial <= 0) updated.estado_pago = 'pagado' // el abono cubre el total → pagado
    }

    // "Registrar" un borrador: cuando la ficha aún no tiene código (cliente
    // creado por el bot, estado 'borrador') y el front pide registrar, genera el
    // código, pasa a 'pendiente' y manda el correo de bienvenida al tutor.
    const esBorrador = !String(rows[idx].codigo || '').trim() || rows[idx].estado === 'borrador'
    let codigoGenerado = ''
    if (body.registrar === true && esBorrador) {
      const letra = String(candidate.letra_especie || '').trim()
      if (!letra) {
        return NextResponse.json({ error: 'Falta la especie: es necesaria para generar el código.' }, { status: 400 })
      }
      // El tipo de servicio debe elegirse EXPLÍCITAMENTE antes de registrar: si
      // quedara vacío, el código saldría con el fallback 'CI' pero la ficha
      // persistiría sin servicio (código P133-CI con tipo_servicio vacío).
      if (!String(candidate.codigo_servicio || '').trim()) {
        return NextResponse.json({ error: 'Selecciona el tipo de servicio antes de registrar la ficha.' }, { status: 400 })
      }
      codigoGenerado = await generarCodigo(letra, String(candidate.codigo_servicio))
      updated.codigo = codigoGenerado
      if (!updated.estado || updated.estado === 'borrador') updated.estado = 'pendiente'
    }

    // GREDA incluida (CI): sincronizar el descuento por tramo de peso. Solo para
    // fichas ya TRACKED (greda_descontada != '') o que se REGISTRAN en este
    // request; las fichas legadas (creadas antes de esta funcionalidad) quedan
    // en '' y no se tocan, para no descontar retroactivamente inventario que ya
    // se contó a mano. Cubre: registro de borrador, cambio de peso que cruza de
    // tramo (S↔M↔L) y cambio de servicio (CI↔CP/SD devuelve/descuenta la greda).
    const gredaPrevia = String(rows[idx].greda_descontada || '')
    let gredaNueva: string | null = null
    if (gredaPrevia !== '' || (body.registrar === true && esBorrador)) {
      try {
        gredaNueva = await gredaEsperada(updated)
        updated.greda_descontada = gredaNueva
      } catch (e) { console.warn('[clientes PATCH] greda no resuelta (se mantiene la previa):', e) }
    }

    // Escribir. generarCodigo hace max+1 (no atómico): dos registros simultáneos
    // de la misma especie podrían generar el mismo código. Si existe el índice
    // único de `clientes.codigo` (ver supabase/schema-principal.sql), el segundo
    // write choca; lo detectamos, regeneramos y reintentamos. Sin el índice no
    // hay conflicto → este loop corre una sola vez.
    let intentosCodigo = 0
    for (;;) {
      try {
        await updateById('clientes', String(updated.id), updated)
        break
      } catch (e) {
        const msg = String(e).toLowerCase()
        const choqueCodigo = !!codigoGenerado && intentosCodigo < 8 &&
          (msg.includes('duplicate') || msg.includes('unique')) && msg.includes('codigo')
        if (!choqueCodigo) throw e
        intentosCodigo++
        codigoGenerado = await generarCodigo(String(candidate.letra_especie || '').trim(), String(candidate.codigo_servicio || 'CI'))
        updated.codigo = codigoGenerado
      }
    }

    // Aplicar en Bodega el cambio de greda (devolver la previa / descontar la
    // nueva), recién DESPUÉS del write exitoso de la ficha (best-effort).
    if (gredaNueva !== null && gredaNueva !== gredaPrevia) {
      try { await aplicarCambioGreda(gredaPrevia, gredaNueva) }
      catch (e) { console.warn('[clientes PATCH] stock greda:', e) }
    }

    // Sincronizar el saldo del pago parcial con `cobros` (best-effort): mantiene
    // un cobro 'saldo' abierto por el pendiente, o cierra los abiertos si la ficha
    // ya no está en pago parcial (se pagó todo o volvió a pendiente).
    try {
      if (String(updated.estado_pago || '').toLowerCase() === 'parcial' && pendienteParcial > 0) {
        await sincronizarSaldoParcial(String(updated.id), pendienteParcial)
      } else {
        await cerrarSaldoParcial(String(updated.id))
      }
    } catch (e) { console.warn('[clientes PATCH] sync saldo parcial falló:', e) }

    // Correo de bienvenida con el código, solo al registrar (best-effort).
    if (codigoGenerado && String(updated.email || '').trim()) {
      try {
        await enviarRegistroMascota({
          email: String(updated.email),
          nombreMascota: String(updated.nombre_mascota || ''),
          nombreTutor: String(updated.nombre_tutor || ''),
          codigo: codigoGenerado,
          clienteId: String(updated.id || ''),
          codigoServicio: String(updated.codigo_servicio || ''),
          resumen: (await resumenCompraDeFicha(updated).catch(() => null)) ?? undefined,
        })
      } catch (e) {
        console.warn('[clientes PATCH] fallo mail registro (no bloqueante):', e)
      }
    }

    // COBRO por productos adicionales AGREGADOS a una ficha YA registrada (NO al
    // registrar: ahí los adicionales son parte de la cotización inicial). Diff
    // old-vs-new: cada adicional nuevo dispara el correo + WhatsApp de cobro y
    // crea un "cobro pendiente". Best-effort. Mismo camino que usa el bot.
    if (body.adicionales !== undefined && !body.registrar && String(rows[idx].codigo || '').trim()) {
      try {
        type AdRaw = { tipo?: string; id?: string; nombre?: string; precio?: number; qty?: number }
        const keyOf = (a: AdRaw) => `${a.tipo || ''}:${a.id || ''}:${a.nombre || ''}`
        const antes = new Set((parseAdicionales(rows[idx].adicionales) as AdRaw[]).map(keyOf))
        let nuevos = (parseAdicionales(body.adicionales) as AdRaw[]).filter(a => !antes.has(keyOf(a)))
        if (nuevos.length > 0) {
          // No cobrar ánforas premium INCLUIDAS en Cremación Premium (bug real:
          // se llegó a cobrar un ánfora incluida por su precio de catálogo).
          const productos = await getSheetData('productos').catch(() => [] as Record<string, string>[])
          const categoriaPorProductoId = new Map(productos.map(p => [String(p.id), String(p.categoria ?? '')]))
          nuevos = excluirIncluidos(codigoServSnap, nuevos, categoriaPorProductoId)
        }
        if (nuevos.length > 0) {
          await dispararCobroAdicional(
            { id: String(updated.id), email: String(updated.email || ''), nombre_tutor: String(updated.nombre_tutor || ''), nombre_mascota: String(updated.nombre_mascota || ''), telefono: String(updated.telefono || '') },
            nuevos.map(a => ({ nombre: String(a.nombre || ''), precio: Number(a.precio) || 0, qty: Number(a.qty) || 1 })),
          )
        }
      } catch (e) {
        console.warn('[clientes PATCH] fallo cobro adicional (no bloqueante):', e)
      }
    }

    // EMISIÓN AUTOMÁTICA DE BOLETA (39) AL TUTOR cuando la ficha pasa a PAGADA.
    // Solo en la transición real pendiente/parcial → pagada (el helper aplica el
    // resto de las guardas: tutor, registrada, sin boleta previa). Best-effort.
    const pagoAntes = String(rows[idx].estado_pago || '').toLowerCase()
    const pagoAhora = String(updated.estado_pago || '').toLowerCase()
    if (pagoAntes !== 'pagado' && pagoAhora === 'pagado') {
      const { boleta_id } = await emitirBoletaSiCorresponde(updated as Record<string, string>, { creadoPorNombre: 'Automático (pago confirmado)' })
      if (boleta_id) updated.boleta_id = boleta_id
    }

    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/**
 * Eliminar una ficha de cliente. Solo admin.
 *
 * Antes de borrar la fila, limpia las referencias cruzadas para no dejar datos huérfanos:
 *  - Devuelve al stock las unidades de productos adicionales que la ficha estaba consumiendo.
 *  - Quita el id del cliente de la lista `mascotas_ids` del ciclo asociado (si tenía uno).
 *  - Quita el id del cliente del despacho asociado: columnas JSON `mascotas_ids`,
 *    `paradas` y `entregas` (regenerando el orden de las paradas restantes).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const role = (session?.user as { role?: string })?.role
    if (!esAdmin(role)) {
      return NextResponse.json({ error: 'Solo administradores pueden eliminar fichas' }, { status: 403 })
    }

    const { id } = await params
    const rows = await getSheetData('clientes')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const cliente = rows[idx]

    // 1) Revertir stock de productos adicionales (devolver lo que consumió esta ficha)
    const items = parseAdicionales(cliente.adicionales)
    if (items.length > 0) {
      await ajustarStockAdicionales(items, [])
    }

    // 1b) Devolver la greda descontada por tramo de peso (si la ficha era tracked)
    const gredaDescontada = String(cliente.greda_descontada || '')
    if (gredaDescontada && gredaDescontada !== '-') {
      try { await ajustarStock(gredaDescontada, +1) }
      catch (e) { console.warn('[clientes/delete] no se pudo devolver la greda al stock:', e) }
    }

    // 2) Limpiar referencia en el ciclo (si tenía uno)
    if (cliente.ciclo_id) {
      try {
        const ciclos = await getSheetData('ciclos')
        const cidx = ciclos.findIndex(c => c.id === cliente.ciclo_id)
        if (cidx !== -1) {
          const ciclo = ciclos[cidx]
          const idsRaw = (ciclo.mascotas_ids ?? '').toString()
          const idsArr = idsRaw.split(',').map(s => s.trim()).filter(Boolean)
          if (idsArr.includes(id)) {
            const filtrados = idsArr.filter(x => x !== id)
            await updateById('ciclos', ciclo.id, { ...ciclo, mascotas_ids: filtrados.join(',') })
          }
        }
      } catch (err) {
        console.warn('[clientes/delete] no se pudo limpiar referencia en ciclo:', err)
      }
    }

    // 3) Limpiar referencia en el despacho (si tenía uno). Las tres listas son
    // JSON (no CSV): mascotas_ids [array], paradas [array de {cliente_id,…}],
    // entregas {por cliente}. Quitamos la mascota de las tres y reordenamos las
    // paradas restantes (mismo formato que despachos POST/PATCH).
    if (cliente.despacho_id) {
      try {
        const despachos = await getSheetData('despachos')
        const didx = despachos.findIndex(d => d.id === cliente.despacho_id)
        if (didx !== -1) {
          const desp = despachos[didx]
          const mascotasIds = parseJsonSafe<string[]>(desp.mascotas_ids, [])
          const paradas = parseJsonSafe<Parada[]>(desp.paradas, [])
          const entregas = parseJsonSafe<Record<string, { fecha_hora: string }>>(desp.entregas, {})
          const estaReferenciado =
            mascotasIds.some(m => String(m) === id) ||
            paradas.some(p => String(p.cliente_id) === id) ||
            entregas[id] !== undefined
          if (estaReferenciado) {
            const nuevasMascotas = mascotasIds.filter(m => String(m) !== id)
            const nuevasParadas = paradas
              .filter(p => String(p.cliente_id) !== id)
              .map((p, i) => ({ ...p, orden: i + 1 }))
            const nuevasEntregas: Record<string, { fecha_hora: string }> = {}
            for (const [k, v] of Object.entries(entregas)) if (k !== id) nuevasEntregas[k] = v
            await updateById('despachos', desp.id, {
              ...desp,
              mascotas_ids: JSON.stringify(nuevasMascotas),
              paradas: JSON.stringify(nuevasParadas),
              entregas: JSON.stringify(nuevasEntregas),
            })
          }
        }
      } catch (err) {
        console.warn('[clientes/delete] no se pudo limpiar referencia en despacho:', err)
      }
    }

    // 4) Borrar la fila del cliente
    await deleteRow('clientes', idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

type AdicionalItem = { tipo: string; id: string; qty?: number }
type Parada = { cliente_id: string; orden?: number; lat?: number; lng?: number; direccion?: string }

function parseAdicionales(raw: string | undefined): AdicionalItem[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

/** Parseo JSON tolerante: devuelve fallback si el valor está vacío o no es JSON. */
function parseJsonSafe<T>(raw: string | undefined, fallback: T): T {
  try { const x = JSON.parse(raw || ''); return (x ?? fallback) as T } catch { return fallback }
}

// (el diff de stock de adicionales vive en lib/stock.ts → ajustarStockAdicionales,
// compartido con clientes POST y el agregar_adicional del bot)
