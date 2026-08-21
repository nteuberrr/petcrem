'use client'
import { PageHeader } from '@/components/ui/kit'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  Bell, CreditCard, Snowflake, Package, FilePen, Coins, MailWarning, Undo2,
  SlidersHorizontal, Image, Video, FolderOpen, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { TableSkeleton } from '@/components/ui/Skeleton'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import { fmtKg, fmtPrecio, fmtFecha } from '@/lib/format'
import { todayISO, formatDateForSheet } from '@/lib/dates'
import { parseDecimal, parsePeso } from '@/lib/numbers'
import { findTramo } from '@/lib/tramos'
import { anforaPremiumIncluida, servicioIncluyeAnforaPremium, repartirAnforasPremium } from '@/lib/anforas-premium'
import { esComunaNoCubierta } from '@/lib/cobertura'
import { aplicaReglaAuto, etiquetaRegla } from '@/lib/adicionales-auto'
import { ORIGENES_MANUALES, labelOrigen } from '@/lib/origen-cliente'
import { pidioVideo } from '@/lib/video-solicitado'
import {
  cumpleFiltro, FILTROS_VALIDOS,
  type FiltroSituacion, type ContextoAlertas, type ResumenFichas, type TramoPrecio,
} from '@/lib/fichas-alertas'

type Cliente = {
  id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  email?: string; telefono?: string
  especie: string; peso_declarado?: string; peso_ingreso?: string
  tipo_servicio: string; codigo_servicio: string
  estado: string; estado_pago?: string; tipo_pago?: string
  fecha_retiro: string; hora_retiro?: string; fecha_creacion: string; ciclo_id: string
  fecha_defuncion?: string; fecha_nacimiento?: string
  direccion_retiro?: string; direccion_despacho?: string; comuna?: string; depto?: string
  adicionales?: string
  veterinaria_id?: string; tipo_precios?: string; notas?: string; origen?: string
  fecha_pago?: string; despacho_id?: string; boleta_id?: string; omitir_evaluacion?: string
  fotos_cuadro?: string; videos_servicio?: string; video_solicitado?: string
  fotos_mascota?: string; fotos_evidencia?: string; fotos_entrega?: string
  memorial_consentimiento?: string; memorial_comentario?: string; memorial_publicado_at?: string
  correo_diferencia_fecha?: string; correo_diferencia_monto?: string
  precio_servicio?: string; precio_adicionales?: string; precio_total?: string
  /** Rebaja manual del total hecha por el dueño (positivo = resta). */
  ajuste_admin?: string; ajuste_admin_motivo?: string
  /** Valor a cobrar de la eutanasia a domicilio asociada (fuera de boleta); lo agrega el GET de la lista. */
  eutanasia_valor?: string
  /** Estimación EN VIVO del valor a cobrar (fichas sin precio congelado: las que
   *  nacen de un agendamiento y siguen "por ingresar"). La agrega el GET. */
  precio_estimado?: string
  precio_estimado_total?: string
  precio_estimado_lineas?: string
  precio_estimado_modalidad?: string
  precio_estimado_modalidad_asumida?: string
  precio_estimado_falta_peso?: string
  descuento_monto?: string; descuento_nombre?: string
}
type Especie = { id: string; nombre: string; letra: string; activo: string }
type Veterinario = { id: string; nombre: string; activo: string; tipo_precios?: string }
type Producto = { id: string; nombre: string; precio: string; stock: string; categoria?: string; activo: string }
type OtroServicio = { id: string; nombre: string; precio: string; activo: string; auto_regla?: string; comunas?: string }
type AdicionalItem = { tipo: 'producto' | 'servicio'; id: string; nombre: string; precio: number; qty: number }
type Descuento = { id: string; nombre: string; tipo: string; valor: string; activo: string }

const NOMBRE_MODALIDAD: Record<string, string> = { CI: 'Cremación Individual', CP: 'Cremación Premium', SD: 'Cremación Sin Devolución' }
/** Línea del desglose de la tarjeta. `tono`: verde = a favor del tutor (descuento
 *  de convenio, ánfora incluida); rojo = ajuste manual del dueño, plata que se
 *  deja de cobrar y no debe confundirse con una tarifa acordada. */
type LineaResumen = { nombre: string; valor: string; tono?: 'verde' | 'rojo' }
type ResumenServicio = { lineas: LineaResumen[]; total: number; estimado?: boolean; nota?: string }
const intCLP = (v: unknown) => parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10) || 0
type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string }
type TramoEspecial = Tramo & { veterinaria_id: string }
type FichaCreada = {
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  codigo_servicio: string
  precio_servicio: number
  precio_normal: number
  mostrar_precio_normal: boolean
  tabla_nombre: string
  rango_tramo: string | null
  peso_kg: number
  adicionales: AdicionalItem[]
  total_adicionales: number
  descuento_nombre: string
  descuento_etiqueta: string
  descuento_monto: number
  total: number
}

const FORM_DEFAULT = {
  nombre_mascota: '',
  nombre_tutor: '',
  email: '',
  telefono: '',
  direccion_retiro: '',
  direccion_despacho: '',
  misma_direccion: false,
  depto: '',
  comuna: '',
  fecha_retiro: '',
  hora_retiro: '',
  fecha_defuncion: '',
  fecha_nacimiento: '',
  especie: '',
  letra_especie: '',
  peso_declarado: '',
  tipo_servicio: 'Cremación Individual',
  codigo_servicio: 'CI',
  veterinaria_id: '',
  tipo_pago: '',
  estado_pago: 'pendiente',
  fecha_pago: '',
  origen: '',
}

const SERVICIOS = [
  { nombre: 'Cremación Individual', codigo: 'CI' },
  { nombre: 'Cremación Premium', codigo: 'CP' },
  { nombre: 'Cremación Sin Devolución', codigo: 'SD' },
]

/**
 * Los campos que una ficha necesita para poder registrarse, con su etiqueta.
 * Son los MISMOS que mira `tieneDatosPendientes` (lib/fichas-alertas): el chip
 * "Datos pendientes" cuenta con ese predicado y el resumen los nombra con esta
 * lista, así que si se agrega un obligatorio va en los dos lados o el chip y el
 * detalle dicen cosas distintas.
 */
const CAMPOS_REQUERIDOS: { campo: keyof Cliente; label: string }[] = [
  { campo: 'nombre_mascota', label: 'Nombre de la mascota' },
  { campo: 'nombre_tutor', label: 'Nombre del tutor' },
  { campo: 'email', label: 'Email' },
  { campo: 'telefono', label: 'Teléfono' },
  { campo: 'direccion_retiro', label: 'Dirección de retiro' },
  { campo: 'direccion_despacho', label: 'Dirección de despacho' },
  { campo: 'comuna', label: 'Comuna' },
  { campo: 'fecha_retiro', label: 'Fecha de retiro' },
  { campo: 'especie', label: 'Especie' },
  { campo: 'peso_declarado', label: 'Peso declarado' },
  { campo: 'codigo_servicio', label: 'Servicio' },
  { campo: 'tipo_pago', label: 'Forma de pago' },
  { campo: 'estado_pago', label: 'Estado de pago' },
]

/** Nombre legible de un movimiento de plata (tabla `cobros`). */
const NOMBRE_COBRO: Record<string, string> = {
  diferencia: 'Diferencia de peso por cobrar',
  saldo: 'Saldo pendiente (pago parcial)',
  adicional: 'Productos adicionales por cobrar',
  devolucion: 'Devolución al tutor',
}

const LABEL_ESTADO: Record<string, string> = {
  borrador: 'Por ingresar', pendiente: 'Retirado', cremado: 'Cremado', despachado: 'Entregado',
}
const LABEL_PAGO: Record<string, string> = {
  pendiente: 'Pendiente de pago', parcial: 'Pago parcial', pagado: 'Pagado',
}
const LABEL_TIPO_PRECIOS: Record<string, string> = {
  general: 'Precios generales', convenio: 'Precios convenio', especial: 'Precios especiales',
}

/** Cuántas fichas se PINTAN por tanda (ver `visibles`). */
const PAGINA = 40

/**
 * Cuántas fichas trae la PRIMERA carga. La sección se abre con las más recientes
 * —que es con lo que trabaja el equipo— y el histórico completo entra después en
 * segundo plano, sin bloquear. Con 375 fichas la carga completa eran ~2,8 s de
 * pantalla en blanco, y suben ~46 por mes.
 */
const PRIMERA_TANDA = 120

/** Formas de pago del alta de ficha + "sin definir" para las que no la tienen. */
const FORMAS_PAGO = [
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'pos', label: 'POS' },
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'link', label: 'Link de pago' },
  { id: '__sin__', label: 'Sin definir' },
] as const

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [buscar, setBuscar] = useState('')
  // Los filtros son INDEPENDIENTES y se combinan (AND): situación + rango de
  // fechas + forma(s) de pago + veterinaria. Solo la situación es de a una.
  const [filtro, setFiltro] = useState<FiltroSituacion>('todos')
  const [filtroVet, setFiltroVet] = useState('') // '' = todas · '__general__' = sin vet · id de vet
  // Rango de fechas: sobre la fecha de retiro o la de creación de la ficha.
  const [fechaCampo, setFechaCampo] = useState<'fecha_retiro' | 'fecha_creacion'>('fecha_retiro')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  // Formas de pago seleccionadas (multi). Vacío = todas.
  const [filtroPagos, setFiltroPagos] = useState<string[]>([])
  const togglePago = (v: string) => setFiltroPagos(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selected, setSelected] = useState<Cliente | null>(null)
  const [especies, setEspecies] = useState<Especie[]>([])
  const [veterinarias, setVeterinarias] = useState<Veterinario[]>([])
  const [productosDisp, setProductosDisp] = useState<Producto[]>([])
  const [otrosServicios, setOtrosServicios] = useState<OtroServicio[]>([])
  // Lógica invertida: por defecto es General (sin veterinaria). El checkbox
  // dice "Cliente de Veterinaria" — al marcarlo aparece el selector.
  const [esClienteVet, setEsClienteVet] = useState(false)
  const noEsVeterinaria = !esClienteVet
  const [adicionales, setAdicionales] = useState<AdicionalItem[]>([])
  const [showAdicionales, setShowAdicionales] = useState(false)
  // Categorías de productos expandidas dentro de "Adicionales" (cerradas por
  // defecto: colapsadas muestran solo lo ya seleccionado).
  const [catsAbiertas, setCatsAbiertas] = useState<Set<string>>(new Set())
  const toggleCat = (cat: string) => setCatsAbiertas(s => {
    const n = new Set(s)
    if (n.has(cat)) n.delete(cat); else n.add(cat)
    return n
  })
  const [descuentosDisp, setDescuentosDisp] = useState<Descuento[]>([])
  const [aplicarDescuento, setAplicarDescuento] = useState(false)
  const [descuentoId, setDescuentoId] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)  // guard anti doble-click al crear ficha (ver handleSubmit)
  const [form, setForm] = useState(FORM_DEFAULT)
  // Pago parcial en el alta manual: monto abonado (el resto queda como saldo pendiente).
  const [abonoNueva, setAbonoNueva] = useState('')
  const [formError, setFormError] = useState('')
  const [preciosGenerales, setPreciosGenerales] = useState<Tramo[]>([])
  const [preciosConvenio, setPreciosConvenio] = useState<Tramo[]>([])
  const [tramosEspeciales, setTramosEspeciales] = useState<TramoEspecial[]>([])
  const [fichaCreada, setFichaCreada] = useState<FichaCreada | null>(null)

  // Declarados ANTES que los useMemo/funciones que los usan (kpis, tieneDiferenciaPorCobrar):
  // encontrarTramo es un const (no hoisteable) — declararlo más abajo rompía la página con
  // "Cannot access 'encontrarTramo' before initialization" apenas hubiera un cliente con
  // peso_ingreso > peso_declarado. Regla de borde canónica (única fuente): lib/tramos.ts
  // findTramo — intervalos (min, max], en el límite gana el MENOR.
  const encontrarTramo = (tabla: Tramo[], peso: number): Tramo | null => findTramo(tabla, peso)
  function precioDelTramo(t: Tramo | null, codigo: string): number {
    if (!t) return 0
    const raw = codigo === 'CP' ? t.precio_cp : codigo === 'SD' ? t.precio_sd : t.precio_ci
    return parseFloat(raw) || 0
  }
  // Cobros NO pagados (tabla `cobros`): diferencia de peso o producto adicional que
  // ya se cobró al tutor pero todavía no se marca como pagado. Alimenta el chip
  // "pendiente de cobro" (distinto de la diferencia SUGERIDA, que es pre-cobro).
  const [cobrosPend, setCobrosPend] = useState<{ id?: string; cliente_id: string; monto: string; detalle: string; tipo: string; estado?: string }[]>([])

  /** ¿Ya llegó el histórico completo, o estamos con la primera tanda? */
  const [historicoCompleto, setHistoricoCompleto] = useState(false)
  // En un ref además del estado: `fetchClientes` es un useCallback sin deps y
  // necesita el valor VIGENTE al recargar tras guardar una ficha (si leyera el
  // estado capturado, volvería a mostrar 120 y la lista parpadearía).
  const historicoRef = useRef(false)

  /**
   * Carga en DOS tiempos: primero las últimas PRIMERA_TANDA fichas (la pantalla
   * pinta en ~medio segundo) y enseguida, sin bloquear, el histórico completo,
   * que reemplaza a la primera tanda cuando llega. Los CONTEOS de los chips no
   * dependen de esto: salen de /api/clientes/resumen, que cuenta en el servidor
   * sobre todas las fichas.
   */
  const fetchClientes = useCallback(async () => {
    // Recarga posterior (guardaste una ficha): el histórico ya está en pantalla,
    // así que se pide entero de una y no se pasa por la tanda corta.
    if (!historicoRef.current) {
      setLoading(true)
      try {
        const res = await fetch(`/api/clientes?ultimas=${PRIMERA_TANDA}`)
        const data = await res.json()
        setClientes(Array.isArray(data) ? data : [])
      } catch { setClientes([]) }
      setLoading(false)
    }
    try {
      const res = await fetch('/api/clientes')
      const data = await res.json()
      if (Array.isArray(data)) {
        setClientes(data)
        historicoRef.current = true
        setHistoricoCompleto(true)
      }
    } catch { /* nos quedamos con lo que haya */ }
  }, [])

  useEffect(() => { fetchClientes() }, [fetchClientes])

  // Conteos de los chips, calculados en el servidor sobre TODAS las fichas.
  const [resumen, setResumen] = useState<ResumenFichas | null>(null)
  const fetchResumen = useCallback(async () => {
    try {
      const r = await fetch('/api/clientes/resumen')
      const d = await r.json()
      if (d && typeof d.total === 'number') setResumen(d as ResumenFichas)
    } catch { /* los chips simplemente no se muestran */ }
  }, [])
  useEffect(() => { fetchResumen() }, [fetchResumen])

  const fetchCobros = useCallback(async () => {
    try {
      const r = await fetch('/api/cobros')
      const d = await r.json()
      setCobrosPend(Array.isArray(d.cobros) ? d.cobros : [])
    } catch { setCobrosPend([]) }
  }, [])
  useEffect(() => { fetchCobros() }, [fetchCobros])

  // Correos de tutores con problemas de entrega (rebotó / spam / falló) según
  // correos_cliente: control para corregir la dirección en la ficha. Deja de
  // aparecer solo cuando la ficha queda con OTRA dirección.
  const [correosMalos, setCorreosMalos] = useState<{ cliente_id: string; codigo: string; nombre_mascota: string; nombre_tutor: string; email: string; estado: string }[]>([])
  useEffect(() => {
    fetch('/api/clientes/correos-problema')
      .then(r => r.json())
      .then(d => setCorreosMalos(Array.isArray(d) ? d : []))
      .catch(() => setCorreosMalos([]))
  }, [clientes])
  const idsCorreoMalo = useMemo(() => new Set(correosMalos.map(c => String(c.cliente_id))), [correosMalos])

  useEffect(() => {
    fetch('/api/especies').then(r => r.json()).then(d => setEspecies(Array.isArray(d) ? d.filter((e: Especie) => e.activo === 'TRUE') : []))
    fetch('/api/veterinarios?activo=true').then(r => r.json()).then(d => setVeterinarias(Array.isArray(d) ? d : []))
    fetch('/api/productos').then(r => r.json()).then(d => {
      if (!Array.isArray(d)) return setProductosDisp([])
      const vistos = new Set<string>()
      setProductosDisp(d.filter((p: Producto) => p.activo === 'TRUE' && !vistos.has(p.id) && (vistos.add(p.id), true)))
    })
    fetch('/api/servicios?tipo=otros').then(r => r.json()).then(d => {
      if (!Array.isArray(d)) return setOtrosServicios([])
      const vistos = new Set<string>()
      setOtrosServicios(d.filter((s: OtroServicio) => s.activo === 'TRUE' && !vistos.has(s.id) && (vistos.add(s.id), true)))
    })
    fetch('/api/precios?tipo=general').then(r => r.json()).then(d => setPreciosGenerales(Array.isArray(d) ? d : []))
    fetch('/api/precios?tipo=convenio').then(r => r.json()).then(d => setPreciosConvenio(Array.isArray(d) ? d : []))
    fetch('/api/descuentos').then(r => r.json()).then(d => setDescuentosDisp(Array.isArray(d) ? d.filter((x: Descuento) => x.activo === 'TRUE') : []))
  }, [])

  // Cargar precios especiales cuando se selecciona una veterinaria con esa modalidad.
  useEffect(() => {
    const vetId = form.veterinaria_id
    if (!vetId || noEsVeterinaria) { setTramosEspeciales([]); return }
    const vet = veterinarias.find(v => v.id === vetId)
    if (vet?.tipo_precios === 'precios_especiales') {
      fetch(`/api/precios/especiales?veterinaria_id=${vetId}`)
        .then(r => r.json())
        .then(d => setTramosEspeciales(Array.isArray(d) ? d : []))
    } else {
      setTramosEspeciales([])
    }
  }, [form.veterinaria_id, noEsVeterinaria, veterinarias])

  // Íconos de estado para las tarjetas.
  const jsonTieneItems = (s?: string) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) && a.length > 0 } catch { return false } }
  const esPremiumCuadro = (c: Cliente) => (c.codigo_servicio || '').toUpperCase() === 'CP'
  const solicitoVideo = (c: Cliente) => pidioVideo(c)

  // Ids de fichas con al menos un COBRO no pagado (de la tabla `cobros`). Las
  // devoluciones viven en la misma tabla pero son plata que sale, no que entra:
  // van en su propio conjunto para no aparecer nunca como "pendiente de cobro".
  const idsConCobroPendiente = useMemo(
    () => new Set(cobrosPend.filter(c => c.tipo !== 'devolucion').map(c => String(c.cliente_id))),
    [cobrosPend],
  )
  /** Ficha → monto que le debemos devolver al tutor (0 si no le debemos nada). */
  const devolucionPorFicha = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cobrosPend) {
      if (c.tipo !== 'devolucion') continue
      const monto = parseFloat(String(c.monto).replace(/[^\d.-]/g, '')) || 0
      m.set(String(c.cliente_id), (m.get(String(c.cliente_id)) ?? 0) + monto)
    }
    return m
  }, [cobrosPend])

  /** Lo que necesitan los predicados de situación (lib/fichas-alertas) — los
   *  MISMOS que usa el servidor para contar, así el chip y la lista coinciden. */
  const ctxAlertas: ContextoAlertas = useMemo(() => ({
    preciosGenerales: preciosGenerales as unknown as TramoPrecio[],
    preciosConvenio: preciosConvenio as unknown as TramoPrecio[],
    idsConCobroPendiente,
    devolucionPorFicha,
    idsCorreoMalo,
  }), [preciosGenerales, preciosConvenio, idsConCobroPendiente, devolucionPorFicha, idsCorreoMalo])

  // Resultados filtrados: TODOS los filtros se combinan (AND) — situación,
  // rango de fechas, forma de pago, veterinaria y buscador.
  const resultados = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    const pagosSel = new Set(filtroPagos)

    // Últimos primero (reversa)
    const ordenados = [...clientes].reverse()

    return ordenados.filter(c => {
      // Situación de la ficha (incluye la regla de que los borradores solo se ven
      // bajo "Por ingresar"). Es el MISMO predicado con que el servidor cuenta los
      // chips — ver lib/fichas-alertas.
      if (!cumpleFiltro(c, filtro, ctxAlertas)) return false
      // Filtro por veterinaria (independiente del filtro de estado)
      if (filtroVet === '__general__' && (c.veterinaria_id || '').trim()) return false
      if (filtroVet && filtroVet !== '__general__' && c.veterinaria_id !== filtroVet) return false
      // Filtro por rango de fechas (sobre retiro o creación). Las fichas sin esa
      // fecha quedan fuera apenas se define un extremo del rango.
      if (fechaDesde || fechaHasta) {
        // Las fechas vienen como ISO o serial de Excel: normalizar a YYYY-MM-DD
        // (comparable como string) antes de comparar contra los inputs.
        const iso = formatDateForSheet(c[fechaCampo])
        if (!iso) return false
        if (fechaDesde && iso < fechaDesde) return false
        if (fechaHasta && iso > fechaHasta) return false
      }
      // Filtro por forma(s) de pago
      if (pagosSel.size) {
        const tp = (c.tipo_pago || '').trim().toLowerCase()
        if (!pagosSel.has(tp || '__sin__')) return false
      }
      // Filtro por buscador
      if (q) {
        return (
          c.nombre_mascota?.toLowerCase().includes(q) ||
          c.nombre_tutor?.toLowerCase().includes(q) ||
          c.codigo?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.telefono?.toLowerCase().includes(q)
        )
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscar, filtro, filtroVet, fechaCampo, fechaDesde, fechaHasta, filtroPagos, clientes, preciosGenerales, preciosConvenio, cobrosPend, idsCorreoMalo])

  // ── Render por tandas ───────────────────────────────────────────────────────
  // Aparte de cargar en dos tiempos, las fichas se PINTAN de a PAGINA: dibujar
  // 375 tarjetas de una es lo que hacía sentir lenta la sección. Al llegar al
  // final de la lista se agrega la tanda siguiente; cualquier cambio de filtro o
  // búsqueda vuelve a empezar por la primera.
  const [visibles, setVisibles] = useState(PAGINA)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibles(PAGINA)
  }, [buscar, filtro, filtroVet, fechaCampo, fechaDesde, fechaHasta, filtroPagos])

  useEffect(() => {
    const cont = scrollRef.current
    const sent = sentinelaRef.current
    if (!cont || !sent) return
    // El observer se RE-CREA con cada tanda a propósito: si tras sumar 40 la
    // sentinela sigue a la vista, un observer ya montado no vuelve a dispararse
    // (IntersectionObserver solo avisa las transiciones) y la lista se quedaría
    // pegada. Uno nuevo evalúa al montarse.
    const obs = new IntersectionObserver(
      entradas => { if (entradas[0]?.isIntersecting) setVisibles(v => Math.min(v + PAGINA, resultados.length)) },
      { root: cont, rootMargin: '300px' },
    )
    obs.observe(sent)
    return () => obs.disconnect()
  }, [resultados.length, visibles])

  const mostrados = useMemo(() => resultados.slice(0, visibles), [resultados, visibles])

  // Los conteos de los chips vienen del SERVIDOR (/api/clientes/resumen), que los
  // calcula sobre TODAS las fichas con los mismos predicados de lib/fichas-alertas.
  // Antes se contaban acá sobre `clientes`, y con la carga en dos tiempos eso
  // mostraría de menos hasta que llegara el histórico. Mientras no llega el
  // resumen los chips no se dibujan (mejor nada que un número equivocado).
  const alertas = resumen
  const nBorradores = resumen?.borradores ?? 0
  const totalFichas = resumen ? resumen.total + resumen.borradores : clientes.length

  // Permite llegar con un filtro preseleccionado por URL (ej. desde la alerta
  // del dashboard: /clientes?filtro=borrador). Se lee una vez al montar.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('filtro')
    if (!f) return
    // Compatibilidad: `este_mes` / `esta_semana` eran chips de situación; ahora
    // son atajos del rango de fechas.
    if (f === 'este_mes' || f === 'esta_semana') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      aplicarRango(f === 'este_mes' ? 'mes' : 'semana')
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if ((FILTROS_VALIDOS as string[]).includes(f)) setFiltro(f as FiltroSituacion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Atajos del rango de fechas (setean desde/hasta en ISO). */
  function aplicarRango(rango: 'hoy' | 'semana' | 'mes' | 'mes_pasado') {
    const hoy = new Date()
    const iso = (d: Date) => formatDateForSheet(d)
    if (rango === 'hoy') { setFechaDesde(todayISO()); setFechaHasta(todayISO()); return }
    if (rango === 'semana') {
      const desde = new Date(hoy); desde.setDate(hoy.getDate() - 6)
      setFechaDesde(iso(desde)); setFechaHasta(todayISO()); return
    }
    if (rango === 'mes') {
      setFechaDesde(iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)))
      setFechaHasta(todayISO()); return
    }
    // Mes pasado completo
    setFechaDesde(iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)))
    setFechaHasta(iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0)))
  }

  /** ¿Hay algún filtro activo además del buscador? */
  const hayFiltros = filtro !== 'todos' || !!filtroVet || !!fechaDesde || !!fechaHasta || filtroPagos.length > 0
  // Cuántos filtros hay puestos — se muestra en el botón que los pliega en móvil.
  const cantFiltros = (filtro !== 'todos' ? 1 : 0) + (filtroVet ? 1 : 0)
    + (fechaDesde || fechaHasta ? 1 : 0) + (filtroPagos.length > 0 ? 1 : 0)
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)
  function limpiarFiltros() {
    setFiltro('todos'); setFiltroVet(''); setFechaDesde(''); setFechaHasta(''); setFiltroPagos([])
  }

  // Cargo AUTOMÁTICO de otros servicios (fuera de horario / distancia): según
  // fecha/hora/comuna del retiro se pre-cargan solos en los adicionales, siempre
  // deseleccionables. autoAgregados = los puso el efecto (puede sacarlos si la
  // regla deja de aplicar); autoQuitados = el usuario los desmarcó (no re-agregar).
  const autoAgregadosRef = useRef<Set<string>>(new Set())
  const autoQuitadosRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!showModal) return
    const ctx = { fecha: form.fecha_retiro, hora: form.hora_retiro, comuna: form.comuna }
    setAdicionales(prev => {
      let next = prev
      for (const s of otrosServicios) {
        if (!(s.auto_regla || '').trim()) continue
        const aplica = aplicaReglaAuto(s, ctx)
        const presente = next.some(a => a.tipo === 'servicio' && a.id === s.id)
        if (aplica && !presente && !autoQuitadosRef.current.has(s.id)) {
          autoAgregadosRef.current.add(s.id)
          next = [...next, { tipo: 'servicio' as const, id: s.id, nombre: s.nombre, precio: parseFloat(s.precio) || 0, qty: 1 }]
        } else if (!aplica && presente && autoAgregadosRef.current.has(s.id)) {
          autoAgregadosRef.current.delete(s.id)
          next = next.filter(a => !(a.tipo === 'servicio' && a.id === s.id))
        }
      }
      return next
    })
  }, [showModal, form.fecha_retiro, form.hora_retiro, form.comuna, otrosServicios])

  function toggleAdicional(tipo: 'producto' | 'servicio', item: { id: string; nombre: string; precio: string }) {
    const existing = adicionales.find(a => a.tipo === tipo && a.id === item.id)
    if (existing) {
      // Al desmarcar un servicio auto-cargado, recordarlo para no re-agregarlo solo.
      if (tipo === 'servicio') { autoQuitadosRef.current.add(item.id); autoAgregadosRef.current.delete(item.id) }
      setAdicionales(prev => prev.filter(a => !(a.tipo === tipo && a.id === item.id)))
    } else {
      if (tipo === 'servicio') autoQuitadosRef.current.delete(item.id)
      setAdicionales(prev => [...prev, { tipo, id: item.id, nombre: item.nombre, precio: parseFloat(item.precio) || 0, qty: 1 }])
    }
  }

  function updateQty(tipo: 'producto' | 'servicio', itemId: string, qty: number) {
    setAdicionales(prev => prev.map(a => a.tipo === tipo && a.id === itemId ? { ...a, qty: Math.max(1, qty) } : a))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Guard anti doble-click (regla general del sitio): un doble-click rápido podía
    // crear la ficha dos veces antes de que `saving` re-renderice. El ref bloquea al toque.
    if (savingRef.current) return
    savingRef.current = true
    setFormError('')
    setSaving(true)
    try {
    const pesoDeclarado = parseDecimal(form.peso_declarado) ?? 0
    const body = {
      ...form,
      peso_declarado: pesoDeclarado,
      misma_direccion: form.misma_direccion,
      depto: form.depto,
      direccion_despacho: form.misma_direccion ? form.direccion_retiro : form.direccion_despacho,
      veterinaria_id: noEsVeterinaria ? '' : form.veterinaria_id,
      adicionales: JSON.stringify(adicionales),
      descuento_id: descuentoElegido ? descuentoElegido.id : '',
      descuento_nombre: descuentoElegido ? descuentoElegido.nombre : '',
      descuento_tipo: descuentoElegido ? descuentoElegido.tipo : '',
      descuento_valor: descuentoElegido ? String(descuentoValorNum) : '',
      descuento_monto: descuentoElegido ? String(montoDescuento) : '',
      // Pago parcial: monto abonado (el saldo pendiente lo calcula el backend).
      ...(form.estado_pago === 'parcial' ? { monto_abonado: abonoNueva } : {}),
    }
    const res = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const created = await res.json().catch(() => null) as { codigo?: string } | null
      // Snapshot del resumen para mostrarlo en el modal de éxito (el form se resetea acto seguido)
      setFichaCreada({
        codigo: created?.codigo ?? '',
        nombre_mascota: form.nombre_mascota,
        nombre_tutor: form.nombre_tutor,
        codigo_servicio: codigoServForm,
        precio_servicio: precioServicio,
        precio_normal: precioNormal,
        mostrar_precio_normal: mostrarPrecioNormal,
        tabla_nombre: tablaNombre,
        rango_tramo: rangoTramo,
        peso_kg: pesoKgForm,
        adicionales: [...adicionales],
        total_adicionales: totalAdicionales,
        descuento_nombre: descuentoElegido ? descuentoElegido.nombre : '',
        descuento_etiqueta: descuentoEtiqueta,
        descuento_monto: montoDescuento,
        total: totalServicio,
      })
      setShowModal(false)
      setForm(FORM_DEFAULT)
      setAbonoNueva('')
      setEsClienteVet(false)
      setAdicionales([])
      autoAgregadosRef.current = new Set()
      autoQuitadosRef.current = new Set()
      setShowAdicionales(false)
      setAplicarDescuento(false)
      setDescuentoId('')
      await fetchClientes()
    } else {
      const err = await res.json().catch(() => ({}))
      setFormError(err?.error ?? 'Error al guardar la ficha. Revisa que todos los campos obligatorios estén completos.')
    }
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  // Cremación Premium (CP) incluye UNA ánfora premium sin costo; las adicionales
  // se cobran. `repartoAdic` va alineado 1:1 con `adicionales`.
  const repartoAdic = repartirAnforasPremium(
    form.codigo_servicio, adicionales,
    new Map(productosDisp.map(p => [String(p.id), String(p.categoria ?? '')])),
  )
  const totalAdicionales = repartoAdic.reduce((sum, r) => sum + Math.max(0, r.item.precio) * r.qtyCobrable, 0)

  // Resumen del servicio para la tarjeta de la lista: servicio + adicionales
  // (con "Incluido" para el ánfora premium de una Cremación Premium) + total.
  // Si la ficha todavía no tiene precio congelado (las que nacen de un
  // agendamiento y siguen "por ingresar"), se muestra la ESTIMACIÓN en vivo que
  // calcula el GET, marcada como tal — así toda ficha muestra su valor a cobrar.
  function resumenServicio(c: Cliente): ResumenServicio | null {
    const servicioPrecio = intCLP(c.precio_servicio)
    const total = intCLP(c.precio_total)
    if (servicioPrecio <= 0 && total <= 0) return resumenEstimado(c)
    const cs = (c.codigo_servicio || 'CI').toUpperCase()
    const lineas: LineaResumen[] = [
      { nombre: NOMBRE_MODALIDAD[cs] || 'Cremación', valor: fmtPrecio(servicioPrecio) },
    ]
    let items: AdicionalItem[] = []
    try { const arr = JSON.parse(c.adicionales || '[]'); if (Array.isArray(arr)) items = arr } catch { /* sin adicionales */ }
    const catMap = new Map(productosDisp.map(p => [String(p.id), String(p.categoria ?? '')]))
    const repC = repartirAnforasPremium(cs, items, catMap)
    items.forEach((a, k) => {
      const r = repC[k]
      const monto = Math.max(0, a.precio) * r.qtyCobrable
      const incluidaTotal = r.qtyIncluida > 0 && r.qtyCobrable === 0
      const valor = incluidaTotal ? 'Incluido'
        : r.qtyIncluida > 0 ? `${r.qtyIncluida} incluida · ${fmtPrecio(monto)}`
        : fmtPrecio(monto)
      lineas.push({ nombre: `${a.nombre}${a.qty > 1 ? ` ×${a.qty}` : ''}`, valor, tono: incluidaTotal ? 'verde' : undefined })
    })
    const desc = intCLP(c.descuento_monto)
    if (desc > 0) lineas.push({ nombre: `Descuento${c.descuento_nombre ? ` (${c.descuento_nombre})` : ''}`, valor: `−${fmtPrecio(desc)}`, tono: 'verde' })
    // Ajuste manual del dueño: ya está DENTRO de `precio_total`, pero sin la línea
    // el desglose no sumaría el total y parecería un error de cálculo. Va en ROJO:
    // el verde es del descuento de convenio (una tarifa acordada), mientras que
    // esto es plata que se deja de cobrar a mano y tiene que saltar a la vista.
    const ajuste = intCLP(c.ajuste_admin)
    if (ajuste !== 0) {
      lineas.push({
        nombre: `Ajuste admin${c.ajuste_admin_motivo ? ` (${c.ajuste_admin_motivo})` : ''}`,
        valor: ajuste > 0 ? `−${fmtPrecio(ajuste)}` : `+${fmtPrecio(-ajuste)}`,
        tono: ajuste > 0 ? 'rojo' : undefined,
      })
    }
    // Eutanasia a domicilio asociada: se COBRA junto al retiro (el Total pasa a
    // ser el total a cobrar), pero va fuera de la boleta.
    const eutanasia = intCLP(c.eutanasia_valor)
    if (eutanasia > 0) lineas.push({ nombre: 'Eutanasia a domicilio (fuera de boleta)', valor: fmtPrecio(eutanasia) })
    return { lineas, total: total + eutanasia }
  }

  /**
   * Resumen de una ficha SIN precio congelado, a partir de la estimación en vivo
   * del GET (`precio_estimado_*`). Devuelve null solo si no se pudo estimar
   * (p. ej. la ficha todavía no tiene peso): ahí la tarjeta avisa qué falta.
   */
  function resumenEstimado(c: Cliente): (ResumenServicio & { estimado: boolean }) | null {
    if (String(c.precio_estimado || '').toUpperCase() !== 'TRUE') return null
    const eutanasia = intCLP(c.eutanasia_valor)
    const faltaPeso = String(c.precio_estimado_falta_peso || '').toUpperCase() === 'TRUE'
    if (faltaPeso && eutanasia <= 0) {
      return { lineas: [{ nombre: 'Falta el peso para calcular', valor: '—' }], total: 0, estimado: true, nota: 'Falta el peso' }
    }
    let lineasEst: { nombre: string; monto: number; incluido?: boolean; ajuste?: boolean }[] = []
    try {
      const arr = JSON.parse(c.precio_estimado_lineas || '[]')
      if (Array.isArray(arr)) lineasEst = arr
    } catch { /* sin desglose: queda solo el total */ }
    // Las rebajas vienen con monto NEGATIVO: se muestran como "−$X", igual que en
    // el desglose de una ficha con precio congelado (antes salían "$-20.000").
    // El descuento de convenio va en verde; el ajuste del dueño, en rojo.
    const lineas: LineaResumen[] = lineasEst.map(l => ({
      nombre: l.nombre,
      valor: l.incluido ? 'Incluido' : l.monto < 0 ? `−${fmtPrecio(-l.monto)}` : fmtPrecio(l.monto),
      tono: l.ajuste ? 'rojo' : (l.incluido || l.monto < 0) ? 'verde' : undefined,
    }))
    if (eutanasia > 0) lineas.push({ nombre: 'Eutanasia a domicilio (fuera de boleta)', valor: fmtPrecio(eutanasia) })
    const nota = String(c.precio_estimado_modalidad_asumida || '').toUpperCase() === 'TRUE'
      ? 'Falta la modalidad (estimado como Individual)'
      : faltaPeso ? 'Falta el peso de la mascota' : undefined
    return { lineas, total: intCLP(c.precio_estimado_total) + eutanasia, estimado: true, nota }
  }

  /**
   * Valor a cobrar de una ficha: el precio congelado si ya lo tiene, y si no la
   * estimación en vivo que agrega el GET (fichas nacidas de un agendamiento que
   * siguen "por ingresar"). Incluye la eutanasia asociada (fuera de boleta).
   */
  function valorFicha(c: Cliente): { total: number; estimado: boolean } {
    const congelado = intCLP(c.precio_total)
    const eutanasia = intCLP(c.eutanasia_valor)
    if (congelado > 0) return { total: congelado + eutanasia, estimado: false }
    if (String(c.precio_estimado || '').toUpperCase() === 'TRUE') {
      return { total: intCLP(c.precio_estimado_total) + eutanasia, estimado: true }
    }
    return { total: eutanasia, estimado: eutanasia > 0 }
  }

  /**
   * Monto que FALTA cobrar de una ficha. Suma dos cosas:
   *  - el total del servicio, si todavía no se pagó. En 'parcial' NO se cuenta:
   *    el resto ya vive como un cobro 'saldo' (si no, se contaría doble).
   *  - los cobros pendientes de la ficha (adicional / diferencia de peso / saldo).
   */
  function montoPendiente(c: Cliente): number {
    const estado = (c.estado_pago || '').toLowerCase()
    const base = estado === 'pagado' || estado === 'parcial' ? 0 : valorFicha(c).total
    // Las devoluciones quedan FUERA: son plata que le debemos al tutor, no que él
    // nos deba. Sumarlas acá diría que debe más justo cuando le debemos nosotros.
    const cobros = cobrosPend
      .filter(x => String(x.cliente_id) === String(c.id) && x.tipo !== 'devolucion')
      .reduce((s, x) => s + (parseFloat(String(x.monto).replace(/[^\d.-]/g, '')) || 0), 0)
    return Math.max(0, Math.round(base + cobros))
  }

  /** Nombre de la veterinaria de convenio de una ficha ('' si es cliente general). */
  function nombreVet(id?: string): string {
    const v = (id || '').trim()
    if (!v) return ''
    // La lista trae solo las activas: si la ficha apunta a una dada de baja,
    // igual hay que mostrar algo en vez de dejar el campo vacío.
    return veterinarias.find(x => String(x.id) === v)?.nombre || `Veterinaria #${v}`
  }

  /** Cuántos archivos guarda una columna JSON de la ficha (fotos / videos). */
  const cuentaJson = (s?: string) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.length : 0 } catch { return 0 } }

  /** Los campos obligatorios que esta ficha todavía no tiene. */
  function faltantesDe(c: Cliente): { campo: keyof Cliente; label: string }[] {
    const vacio = (v?: string) => !v || !String(v).trim()
    return CAMPOS_REQUERIDOS.filter(({ campo }) => campo === 'peso_declarado'
      ? parsePeso(c.peso_declarado) <= 0
      : vacio(c[campo]))
  }

  /** Cuánto más habría que cobrar por el tramo del peso real (0 si no hay diferencia). */
  function montoDiferenciaPeso(c: Cliente): number {
    const tabla = c.veterinaria_id ? preciosConvenio : preciosGenerales
    const cod = c.codigo_servicio || 'CI'
    return Math.max(0, precioDelTramo(encontrarTramo(tabla, parsePeso(c.peso_ingreso)), cod)
      - precioDelTramo(encontrarTramo(tabla, parsePeso(c.peso_declarado)), cod))
  }

  /**
   * Todo lo que queda por hacer en una ficha, en una sola lista. Las situaciones
   * las deciden los MISMOS predicados que cuentan los chips (lib/fichas-alertas):
   * si el chip dice que esta ficha tiene el peso pendiente, el resumen tiene que
   * decir lo mismo.
   */
  function alertasFicha(c: Cliente): { texto: string; detalle?: string; monto?: string; tono?: 'rojo' | 'violeta' }[] {
    const out: { texto: string; detalle?: string; monto?: string; tono?: 'rojo' | 'violeta' }[] = []
    if (c.estado === 'borrador') out.push({ texto: 'Ficha por ingresar', detalle: 'todavía no tiene código: complétala y regístrala' })
    const faltan = faltantesDe(c)
    if (faltan.length) out.push({
      texto: `Falta${faltan.length === 1 ? '' : 'n'} ${faltan.length} dato${faltan.length === 1 ? '' : 's'} obligatorio${faltan.length === 1 ? '' : 's'}`,
      detalle: faltan.map(f => f.label).join(' · '),
    })
    if (cumpleFiltro(c, 'falta_peso', ctxAlertas)) out.push({ texto: 'Falta el peso de ingreso', detalle: 'es el que manda para el precio' })
    if (cumpleFiltro(c, 'diferencia', ctxAlertas)) {
      const d = montoDiferenciaPeso(c)
      out.push({ texto: 'Diferencia de peso sin cobrar', detalle: 'el peso real cae en un tramo más caro', monto: d > 0 ? fmtPrecio(d) : undefined })
    }
    // El servicio impago solo cuenta acá si no es un pago parcial: en ese caso el
    // resto ya vive como un cobro 'saldo' y se lista abajo (si no, se ve dos veces).
    const ep = (c.estado_pago || '').toLowerCase()
    if (c.estado !== 'borrador' && ep !== 'pagado' && ep !== 'parcial') {
      out.push({ texto: 'Servicio sin pagar', detalle: c.tipo_pago ? `forma de pago: ${c.tipo_pago}` : 'sin forma de pago definida', monto: fmtPrecio(valorFicha(c).total) })
    }
    for (const cb of cobrosPend.filter(x => String(x.cliente_id) === String(c.id))) {
      const monto = fmtPrecio(parseFloat(String(cb.monto).replace(/[^\d.-]/g, '')) || 0)
      const rotulo = cb.tipo === 'devolucion' ? 'Devolución al tutor' : NOMBRE_COBRO[cb.tipo] ?? 'Cobro pendiente'
      // El detalle del saldo de un pago parcial repite el rótulo tal cual: si se
      // concatena queda "Saldo pendiente (pago parcial) — Saldo pendiente (pago
      // parcial)". Solo se muestra cuando agrega algo.
      const propio = (cb.detalle || '').trim()
      const detalle = [propio.toLowerCase() === rotulo.toLowerCase() ? '' : propio,
        cb.estado === 'cliente_confirmo' ? 'el tutor dice que ya transfirió' : ''].filter(Boolean).join(' · ')
      out.push(cb.tipo === 'devolucion'
        ? { texto: rotulo, detalle: detalle || undefined, monto, tono: 'violeta' }
        : { texto: rotulo, detalle: detalle || undefined, monto })
    }
    const correoMalo = correosMalos.find(x => String(x.cliente_id) === String(c.id))
    if (correoMalo) out.push({ texto: 'El correo del tutor no llega', detalle: `${correoMalo.email} · ${correoMalo.estado} — corrígelo en la ficha` })
    if (cumpleFiltro(c, 'video_pendiente', ctxAlertas)) out.push({ texto: 'Video del proceso pendiente', detalle: 'el tutor lo pidió y todavía no está cargado' })
    if (cumpleFiltro(c, 'datos_observados', ctxAlertas)) out.push({ texto: 'Dato observado por el tutor', detalle: 'respondió que algo está mal — corrígelo antes del certificado' })
    if (esPremiumCuadro(c) && !jsonTieneItems(c.fotos_cuadro)) out.push({ texto: 'Falta la foto del cuadro conmemorativo', detalle: 'la Cremación Premium lo incluye' })
    if (esComunaNoCubierta(c.comuna)) out.push({ texto: 'Comuna fuera de cobertura', detalle: c.comuna })
    if (ep === 'pagado' && !(c.fecha_pago || '').trim()) out.push({ texto: 'Falta la fecha de pago', detalle: 'sin ella la venta no se puede cuadrar en Ventas POS' })
    return out
  }

  const vetSeleccionada = !noEsVeterinaria ? veterinarias.find(v => v.id === form.veterinaria_id) : undefined
  const tipoPrecios: 'general' | 'convenio' | 'especial' = !vetSeleccionada
    ? 'general'
    : vetSeleccionada.tipo_precios === 'precios_especiales' ? 'especial' : 'convenio'
  const tablaPrecios: Tramo[] = tipoPrecios === 'especial' ? tramosEspeciales : tipoPrecios === 'convenio' ? preciosConvenio : preciosGenerales
  const tablaNombre = tipoPrecios === 'especial' ? 'Precios especiales' : tipoPrecios === 'convenio' ? 'Precios convenio' : 'Precios generales'
  const pesoKgForm = parsePeso(form.peso_declarado)
  const tramoAplicable = encontrarTramo(tablaPrecios, pesoKgForm)
  const codigoServForm = form.codigo_servicio || 'CI'
  const precioServicio = precioDelTramo(tramoAplicable, codigoServForm)
  const tramoNormal = encontrarTramo(preciosGenerales, pesoKgForm)
  const precioNormal = precioDelTramo(tramoNormal, codigoServForm)
  const mostrarPrecioNormal = tipoPrecios !== 'general' && precioNormal > 0
  const subtotalServicio = precioServicio + totalAdicionales
  const descuentoElegido = aplicarDescuento && descuentoId
    ? descuentosDisp.find(d => d.id === descuentoId) ?? null
    : null
  const descuentoValorNum = descuentoElegido ? parseFloat(descuentoElegido.valor) || 0 : 0
  // El descuento aplica SOLO al precio de la cremación, nunca a los adicionales
  // (fuera de horario, distancia, ánfora premium, etc. se pagan completos).
  const montoDescuento = !descuentoElegido
    ? 0
    : descuentoElegido.tipo === 'fijo'
      ? Math.min(descuentoValorNum, precioServicio)
      : Math.round((precioServicio * descuentoValorNum) / 100)
  const totalServicio = Math.max(0, subtotalServicio - montoDescuento)
  const descuentoEtiqueta = descuentoElegido
    ? descuentoElegido.tipo === 'fijo' ? fmtPrecio(descuentoValorNum) : `${descuentoValorNum}%`
    : ''
  const rangoTramo = tramoAplicable ? (() => {
    const maxPesoMin = Math.max(...tablaPrecios.map(t => parseFloat(t.peso_min) || 0))
    const min = parseFloat(tramoAplicable.peso_min) || 0
    return min === maxPesoMin ? `${min} kg o más` : `${tramoAplicable.peso_min} – ${tramoAplicable.peso_max} kg`
  })() : null

  return (
    <div>
      <div className="mb-6">
        <PageHeader title="Clientes" subtitle="Fichas de mascotas" actions={<>
          {/* El alta manual de un retiro se hace desde la agenda del dashboard
              ("+ Nueva solicitud"), que es donde se ven los huecos de la semana. */}
          <button
            onClick={() => { setForm({ ...FORM_DEFAULT, fecha_retiro: todayISO() }); autoAgregadosRef.current = new Set(); autoQuitadosRef.current = new Set(); setShowModal(true) }}
            className="bg-brand hover:bg-brand-dark text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-colors"
          >
            + Nueva ficha
          </button>
        </>} />
      </div>

      {/* Notificaciones compactas: una fila de chips clickeables que aplican el
          filtro correspondiente. Reemplaza al banner grande de pago pendiente. */}
      {alertas && (nBorradores > 0 || alertas.pagoPendiente > 0 || alertas.enCamara > 0 || alertas.porDespachar > 0 || alertas.datosPendientes > 0 || alertas.faltaPeso > 0 || alertas.diferencia > 0 || alertas.videoPendiente > 0 || alertas.devolucion > 0 || alertas.datosObservados > 0 || correosMalos.length > 0) && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {nBorradores > 0 && (
            <button onClick={() => setFiltro('borrador')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-red-300 bg-red-50 hover:bg-red-100 px-3 py-1.5 text-xs font-bold text-red-800 shadow-md transition-colors">
              <Bell className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {nBorradores} nueva{nBorradores === 1 ? '' : 's'} reserva{nBorradores === 1 ? '' : 's'} del agente
            </button>
          )}
          {alertas.pagoPendiente > 0 && (
            <button onClick={() => setFiltro('pago_pendiente')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900 shadow-md transition-colors">
              <CreditCard className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {alertas.pagoPendiente} con pago pendiente
            </button>
          )}
          {alertas.enCamara > 0 && (
            <button onClick={() => setFiltro('pendiente')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-sky-300 bg-sky-50 hover:bg-sky-100 px-3 py-1.5 text-xs font-bold text-sky-800 shadow-md transition-colors">
              <Snowflake className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {alertas.enCamara} en cámara por cremar
            </button>
          )}
          {alertas.porDespachar > 0 && (
            <button onClick={() => setFiltro('cremado')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-md transition-colors">
              <Package className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {alertas.porDespachar} cremado{alertas.porDespachar === 1 ? '' : 's'} por despachar
            </button>
          )}
          {alertas.datosPendientes > 0 && (
            <button onClick={() => setFiltro('datos_pendientes')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-orange-300 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 text-xs font-bold text-orange-800 shadow-md transition-colors">
              <FilePen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {alertas.datosPendientes} con datos pendientes
            </button>
          )}
          {alertas.faltaPeso > 0 && (
            <button onClick={() => setFiltro('falta_peso')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-rose-300 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-800 shadow-md transition-colors">
              <span className="font-mono font-extrabold bg-rose-200 text-rose-900 px-1 rounded">KG</span> {alertas.faltaPeso} sin peso de ingreso
            </button>
          )}
          {alertas.diferencia > 0 && (
            <button onClick={() => setFiltro('diferencia')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-fuchsia-300 bg-fuchsia-50 hover:bg-fuchsia-100 px-3 py-1.5 text-xs font-bold text-fuchsia-800 shadow-md transition-colors">
              <Coins className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {alertas.diferencia} con diferencia por cobrar
            </button>
          )}
          {alertas.videoPendiente > 0 && (
            <button onClick={() => setFiltro('video_pendiente')}
              title="Fichas donde el tutor pidió el video del ingreso y todavía no se sube (de agosto en adelante). El video va adjunto en el correo del certificado, el día de la entrega."
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-sky-300 bg-sky-50 hover:bg-sky-100 px-3 py-1.5 text-xs font-bold text-sky-800 shadow-md transition-colors">
              <Video className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {alertas.videoPendiente} con video por subir
            </button>
          )}
          {alertas.datosObservados > 0 && (
            <button onClick={() => setFiltro('datos_observados')}
              title="El tutor respondió que hay un dato malo en la ficha de su mascota. Corrígelo antes de emitir el certificado o imprimir la etiqueta."
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-orange-400 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 text-xs font-bold text-orange-900 shadow-md transition-colors">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {alertas.datosObservados} con un dato observado por el tutor
            </button>
          )}
          {alertas.devolucion > 0 && (
            <button onClick={() => setFiltro('devolucion')}
              title="Fichas cuya boleta cobró más de lo que terminó valiendo el servicio — hay que emitir la nota de crédito y devolverle al tutor"
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-violet-300 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-800 shadow-md transition-colors">
              <Undo2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {alertas.devolucion} con devolución pendiente
              <span className="font-extrabold">· {fmtPrecio(alertas.devolucionMonto)}</span>
            </button>
          )}
          {correosMalos.length > 0 && (
            <button onClick={() => setFiltro('correo_malo')}
              title="Correos de tutores que rebotaron o fallaron — corrígelos en la ficha"
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-red-400 bg-red-50 hover:bg-red-100 px-3 py-1.5 text-xs font-bold text-red-900 shadow-md transition-colors">
              <MailWarning className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {correosMalos.length} correo{correosMalos.length === 1 ? '' : 's'} de tutor rebotado{correosMalos.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}

      {/* Buscador + filtros. Sin tarjetas de KPI arriba (los conteos que importan
          ya están en los chips de notificación) y con los filtros PLEGADOS por
          defecto en cualquier tamaño: al entrar se busca una ficha, no una
          estadística, y desplegados empujaban la primera tarjeta fuera de
          pantalla. */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 p-4 mb-6">
        <input
          type="text"
          placeholder="Buscar por nombre, tutor, código, email o teléfono..."
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
        />
        <button type="button" onClick={() => setFiltrosAbiertos(v => !v)} aria-expanded={filtrosAbiertos}
          className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl border-2 border-gray-300 px-3 py-2 min-h-11 text-xs font-semibold text-gray-700 hover:border-brand hover:bg-brand/5 transition-colors">
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            Filtros
            {cantFiltros > 0 && (
              <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">{cantFiltros}</span>
            )}
          </span>
          <span className="text-brand-soft">{filtrosAbiertos ? 'Ocultar' : 'Mostrar'}</span>
        </button>

        <div className={filtrosAbiertos ? '' : 'hidden'}>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 mr-1">Situación:</span>
          {([
            { id: 'todos', label: 'Todos' },
            { id: 'borrador', label: 'Por ingresar' },
            { id: 'pendiente', label: 'Retirados (en cámara)' },
            { id: 'cremado', label: '✓ Cremados' },
            { id: 'despachado', label: 'Despachados' },
            { id: 'pago_pendiente', label: '⚠ Pago pendiente' },
            { id: 'correo_malo', label: 'Correo rebotado' },
            { id: 'datos_pendientes', label: 'Datos pendientes' },
          ] as const).map(opt => {
            const active = filtro === opt.id
            const esBorr = opt.id === 'borrador'
            return (
              <button
                key={opt.id}
                onClick={() => setFiltro(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors ${
                  active
                    ? 'bg-brand border-brand text-white shadow-md'
                    : esBorr && nBorradores > 0
                      ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                      : 'bg-white border-gray-300 text-gray-700 hover:border-brand hover:bg-brand/10'
                }`}
              >
                {opt.label}{esBorr && nBorradores > 0 ? ` (${nBorradores})` : ''}
              </button>
            )
          })}
        </div>
        {/* Rango de fechas — se combina con el resto de los filtros */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 mr-1">Fecha de:</span>
          <select value={fechaCampo} onChange={e => setFechaCampo(e.target.value as typeof fechaCampo)}
            className="border-2 border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand">
            <option value="fecha_retiro">Retiro</option>
            <option value="fecha_creacion">Creación de la ficha</option>
          </select>
          <label className="text-xs text-gray-600">Desde</label>
          <input type="date" value={fechaDesde} max={fechaHasta || undefined} onChange={e => setFechaDesde(e.target.value)}
            className="border-2 border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand" />
          <label className="text-xs text-gray-600">Hasta</label>
          <input type="date" value={fechaHasta} min={fechaDesde || undefined} onChange={e => setFechaHasta(e.target.value)}
            className="border-2 border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand" />
          {([
            { id: 'hoy', label: 'Hoy' },
            { id: 'semana', label: 'Últimos 7 días' },
            { id: 'mes', label: 'Este mes' },
            { id: 'mes_pasado', label: 'Mes pasado' },
          ] as const).map(r => (
            <button key={r.id} onClick={() => aplicarRango(r.id)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold border-2 border-gray-300 bg-white text-gray-700 hover:border-brand hover:bg-brand/10 transition-colors">
              {r.label}
            </button>
          ))}
          {(fechaDesde || fechaHasta) && (
            <button onClick={() => { setFechaDesde(''); setFechaHasta('') }} className="text-xs text-brand-soft hover:underline">Quitar fechas</button>
          )}
        </div>

        {/* Forma de pago — multi-selección */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 mr-1">Forma de pago:</span>
          {FORMAS_PAGO.map(fp => {
            const active = filtroPagos.includes(fp.id)
            return (
              <button key={fp.id} onClick={() => togglePago(fp.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors ${
                  active ? 'bg-brand border-brand text-white shadow-md' : 'bg-white border-gray-300 text-gray-700 hover:border-brand hover:bg-brand/10'
                }`}>
                {fp.label}
              </button>
            )
          })}
          {filtroPagos.length > 0 && (
            <button onClick={() => setFiltroPagos([])} className="text-xs text-brand-soft hover:underline">Quitar</button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 mr-1">Veterinaria:</span>
          <select value={filtroVet} onChange={e => setFiltroVet(e.target.value)}
            className="border-2 border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand">
            <option value="">Todas</option>
            <option value="__general__">General (sin veterinaria)</option>
            {veterinarias.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
          {filtroVet && (
            <button onClick={() => setFiltroVet('')} className="text-xs text-brand-soft hover:underline">Quitar filtro</button>
          )}
        </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            {visibles < resultados.length ? `Mostrando ${visibles} de ${resultados.length} resultados` : `${resultados.length} resultado${resultados.length !== 1 ? 's' : ''}`} · {totalFichas} en total
            {!historicoCompleto && <span className="ml-1 text-gray-400">· cargando histórico…</span>}
          </p>
          {hayFiltros && (
            <button onClick={limpiarFiltros}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border-2 border-gray-300 bg-white text-gray-700 hover:border-brand hover:bg-brand/10 transition-colors">
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Cards de resultados */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-300"><TableSkeleton rows={8} /></div>
      ) : resultados.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 p-12 text-center text-gray-500 text-sm">
          Sin resultados para tu búsqueda o filtro.
        </div>
      ) : (
        <div ref={scrollRef} className="bg-white rounded-xl shadow-md border-2 border-gray-300 p-4 max-h-[640px] overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pr-1">
          {mostrados.map(c => {
            const resumen = resumenServicio(c)
            return (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              /* @container: la tarjeta decide su propio layout según SU ancho, no
                 según el del navegador. Es lo correcto acá porque el ancho no
                 depende solo de la pantalla sino de cuántas columnas tenga la
                 grilla (1 / 2 / 3): con 3 columnas la tarjeta queda angosta
                 incluso en un monitor grande, y el resumen del servicio le comía
                 el espacio al nombre y a los avisos de cobro, que se salían de su
                 recuadro (reporte del dueño 2026-08-18). */
              className="@container text-left bg-white rounded-xl shadow-md border-2 border-gray-300 hover:border-brand hover:shadow-lg p-4 transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${c.codigo ? 'text-brand bg-brand/10' : 'text-gray-400 bg-gray-100'}`}>{c.codigo || 'sin código'}</span>
                <Badge variant={c.estado === 'cremado' ? 'green' : c.estado === 'despachado' ? 'blue' : 'yellow'}>{c.estado === 'borrador' ? 'Por ingresar' : c.estado && c.estado !== 'pendiente' ? c.estado : 'retirado'}</Badge>
              </div>
              <div className="flex flex-col @[23rem]:flex-row gap-3">
                <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 text-base">{c.nombre_mascota || <span className="text-gray-400 italic">Sin nombre</span>}</p>
              <p className="text-sm text-gray-600">{c.nombre_tutor}</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">{c.especie || (c.estado === 'borrador' ? 'falta especie' : '')}</span>
                <span className="text-gray-300">·</span>
                <span className="text-xs font-semibold text-gray-700">{c.codigo_servicio}</span>
              </div>
              <div className="mt-2 flex items-center gap-3 flex-wrap text-xs text-gray-500">
                <span>
                  <span className="font-semibold text-gray-600">Retiro:</span>{' '}
                  {c.fecha_retiro ? fmtFecha(c.fecha_retiro) : <span className="text-gray-400 italic">sin fecha</span>}
                </span>
                <span>
                  <span className="font-semibold text-gray-600">Peso:</span>{' '}
                  {fmtKg(parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado))}
                </span>
              </div>
              {(esPremiumCuadro(c) || solicitoVideo(c)) && (
                <div className="mt-2 flex items-center gap-1.5">
                  {esPremiumCuadro(c) && (
                    <span title={jsonTieneItems(c.fotos_cuadro) ? 'Cuadro conmemorativo · foto recibida' : 'Cuadro conmemorativo (Premium) · falta la foto del tutor'}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border ${jsonTieneItems(c.fotos_cuadro) ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                      <Image className="w-3.5 h-3.5" aria-hidden="true" /> cuadro
                    </span>
                  )}
                  {solicitoVideo(c) && (
                    <span title={jsonTieneItems(c.videos_servicio) ? 'Video del proceso solicitado · ya cargado' : 'Video del proceso solicitado · pendiente de cargar'}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border ${jsonTieneItems(c.videos_servicio) ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-sky-700 bg-sky-50 border-sky-200'}`}>
                      <Video className="w-3.5 h-3.5" aria-hidden="true" /> video
                    </span>
                  )}
                </div>
              )}
              {idsCorreoMalo.has(String(c.id)) && (
                <p className="mt-2 text-xs font-semibold text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1" title={c.email || ''}>
                  ✉️ El correo del tutor rebotó — corrígelo en la ficha
                </p>
              )}
              {c.estado === 'borrador' && (
                <p className="mt-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  <FolderOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Completa la ficha para registrarla
                </p>
              )}
              {/* Lo que falta cobrar. Antes esto se gateaba con `estado_pago !== 'pagado'`,
                  así que una ficha PAGADA con un cobro abierto (diferencia de peso o
                  adicional) no mostraba nada: aparecía en el filtro "Pago pendiente"
                  pero la tarjeta salía muda — caso Peluchín, $10.000 de diferencia
                  invisibles. Ahora manda `montoPendiente`, que ya suma servicio impago
                  + cobros abiertos, y el monto se muestra SIEMPRE. */}
              {c.estado !== 'borrador' && (() => {
                const pend = montoPendiente(c)
                const tieneCobro = idsConCobroPendiente.has(String(c.id))
                if (c.estado_pago === 'pagado' && !tieneCobro) return null
                const rotulo = c.estado_pago === 'pagado' ? 'Cobro pendiente'
                  : c.estado_pago === 'parcial' ? 'Saldo pendiente'
                  : 'Pago pendiente'
                return (
                  <p className="mt-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex flex-wrap items-center justify-between gap-x-2">
                    <span>⚠ {rotulo}</span>
                    <span className="font-bold whitespace-nowrap">{pend > 0 ? fmtPrecio(pend) : 'sin monto'}</span>
                  </p>
                )
              })()}
              {/* Plata que le DEBEMOS al tutor (hoy: peso real en un tramo más
                  barato con el servicio ya cobrado). Va aparte y en violeta para
                  que no se confunda con lo que él nos debe. */}
              {(devolucionPorFicha.get(String(c.id)) ?? 0) > 0 && (
                <p className="mt-2 text-xs font-semibold text-violet-800 bg-violet-50 border border-violet-200 rounded px-2 py-1 flex flex-wrap items-center justify-between gap-x-2">
                  <span>↩ Devolución pendiente</span>
                  <span className="font-bold whitespace-nowrap">{fmtPrecio(devolucionPorFicha.get(String(c.id)) ?? 0)}</span>
                </p>
              )}
                </div>
                {resumen && (
                  <div className="w-full border-t border-gray-200 pt-3 @[23rem]:w-40 @[23rem]:shrink-0 @[23rem]:border-t-0 @[23rem]:pt-0 @[23rem]:border-l @[23rem]:pl-3">
                    <p className="text-[10px] uppercase tracking-wide font-bold text-gray-500 mb-1.5">
                      Resumen del servicio
                      {resumen.estimado && (
                        <span className="ml-1 text-[9px] font-bold text-amber-900 bg-amber-100 border border-amber-200 px-1 py-px rounded normal-case tracking-normal"
                          title="Valor calculado con las tablas de precios vigentes. Se congela al registrar la ficha.">
                          estimado
                        </span>
                      )}
                    </p>
                    <div className="space-y-1">
                      {resumen.lineas.map((l, i) => (
                        <div key={i} className="flex justify-between gap-2 text-[11px] leading-tight">
                          <span className={`truncate ${l.tono === 'verde' ? 'text-emerald-700' : l.tono === 'rojo' ? 'text-red-600' : 'text-gray-600'}`} title={l.nombre}>{l.nombre}</span>
                          <span className={`shrink-0 font-semibold ${l.tono === 'verde' ? 'text-emerald-700' : l.tono === 'rojo' ? 'text-red-600' : 'text-gray-800'}`}>{l.valor}</span>
                        </div>
                      ))}
                      <div className="flex justify-between gap-2 text-xs pt-1 mt-1 border-t border-gray-200">
                        <span className="font-bold text-gray-700">Total</span>
                        <span className="font-bold text-brand">{fmtPrecio(resumen.total)}</span>
                      </div>
                      {resumen.nota && (
                        <p className="text-[10px] text-amber-800 leading-tight">⚠ {resumen.nota}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </button>
            )
          })}
        </div>
        {/* Sentinela del scroll infinito + salida manual por si el observer no
            corre (navegador viejo, o la lista entra entera sin scrollear). */}
        {visibles < resultados.length && (
          <div ref={sentinelaRef} className="pt-4 pb-1 text-center">
            <button onClick={() => setVisibles(v => Math.min(v + PAGINA, resultados.length))}
              className="px-4 py-2 rounded-lg text-xs font-semibold border-2 border-gray-300 bg-white text-gray-700 hover:border-brand hover:bg-brand/10 transition-colors">
              Ver más · {resultados.length - visibles} restante{resultados.length - visibles === 1 ? '' : 's'}
            </button>
          </div>
        )}
        </div>
      )}

      {/* RESUMEN DE LA FICHA. Muestra TODO lo que la ficha guarda, agrupado igual
          que la ficha completa (tutor · mascota · servicio · pago · valor ·
          proceso · archivos) y con los pendientes en rojo arriba, para decidir sin
          tener que abrirla. Los datos salen de la fila que ya trajo la lista: no
          pide nada al servidor. */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.nombre_mascota || 'Ficha sin nombre'} size="2xl">
        {selected && (() => {
          const c = selected
          const faltan = new Set(faltantesDe(c).map(f => f.campo))
          const alertas = alertasFicha(c)
          const resumen = resumenServicio(c)
          const pendiente = montoPendiente(c)
          const devolucion = devolucionPorFicha.get(String(c.id)) ?? 0
          const correoMalo = correosMalos.find(x => String(x.cliente_id) === String(c.id))
          const pesoIng = parsePeso(c.peso_ingreso)
          const pesoDec = parsePeso(c.peso_declarado)
          const hayDiferencia = pesoIng > 0 && pesoDec > 0 && pesoIng !== pesoDec
          const nFotosTutor = cuentaJson(c.fotos_mascota)
          const nFotosCuadro = cuentaJson(c.fotos_cuadro)
          const nVideos = cuentaJson(c.videos_servicio)
          const nEvidencia = cuentaJson(c.fotos_evidencia)
          const nEntrega = cuentaJson(c.fotos_entrega)
          const memorialOk = String(c.memorial_consentimiento || '').toUpperCase() === 'TRUE'
          const hayArchivos = nFotosTutor + nFotosCuadro + nVideos + nEvidencia + nEntrega > 0
            || memorialOk || !!c.memorial_comentario || esPremiumCuadro(c) || solicitoVideo(c)
          return (
            <div className="space-y-4">
              {/* Identificación */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${c.codigo ? 'text-brand bg-brand/10' : 'text-red-700 bg-red-50 border border-red-200'}`}>
                  {c.codigo || 'sin código'}
                </span>
                <Badge variant={c.estado === 'cremado' ? 'green' : c.estado === 'despachado' ? 'blue' : c.estado === 'borrador' ? 'gray' : 'yellow'}>
                  {LABEL_ESTADO[c.estado] || LABEL_ESTADO.pendiente}
                </Badge>
                {c.estado_pago === 'pagado' ? (
                  <Badge variant="green">Pagado</Badge>
                ) : (
                  <Badge variant="yellow">
                    {c.estado_pago === 'parcial' ? 'Saldo pendiente' : 'Pago pendiente'}
                    {pendiente > 0 ? ` · ${fmtPrecio(pendiente)}` : ''}
                  </Badge>
                )}
                {c.veterinaria_id && <Badge variant="purple">{nombreVet(c.veterinaria_id)}</Badge>}
              </div>

              {/* Pendientes y alertas: lo único accionable del resumen, todo junto
                  y arriba. La devolución va en violeta porque es plata que sale,
                  no que entre — igual que en la tarjeta de la lista. */}
              {alertas.length > 0 && (
                <div className="rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-red-800">
                    Pendientes y alertas · {alertas.length}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {alertas.map((a, i) => (
                      <li key={i} className={`flex items-start justify-between gap-3 text-xs ${a.tono === 'violeta' ? 'text-violet-800' : 'text-red-800'}`}>
                        <span className="min-w-0">
                          <span className="font-semibold">{a.tono === 'violeta' ? '↩' : '⚠'} {a.texto}</span>
                          {a.detalle && <span className="opacity-80"> · {a.detalle}</span>}
                        </span>
                        {a.monto && <span className="shrink-0 font-bold whitespace-nowrap">{a.monto}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <PreviewGrupo titulo="Tutor">
                <PreviewDato label="Nombre" valor={c.nombre_tutor} falta={faltan.has('nombre_tutor')} />
                <PreviewDato label="Email" valor={c.email} falta={faltan.has('email')} alerta={!!correoMalo}
                  nota={correoMalo ? `El correo ${correoMalo.estado === 'rebotado' ? 'rebotó' : correoMalo.estado === 'spam' ? 'fue marcado como spam' : 'falló'}` : undefined} />
                <PreviewDato label="Teléfono" valor={c.telefono} falta={faltan.has('telefono')} />
                <PreviewDato label="Comuna" valor={c.comuna} falta={faltan.has('comuna')} alerta={esComunaNoCubierta(c.comuna)}
                  nota={esComunaNoCubierta(c.comuna) ? 'Fuera de la zona de cobertura' : undefined} />
                <PreviewDato full label="Dirección de retiro" valor={c.direccion_retiro} falta={faltan.has('direccion_retiro')}
                  nota={c.depto ? `Depto ${c.depto}` : undefined} />
                <PreviewDato full label="Dirección de despacho" valor={c.direccion_despacho} falta={faltan.has('direccion_despacho')}
                  nota={c.direccion_despacho && c.direccion_despacho === c.direccion_retiro ? 'La misma del retiro' : undefined} />
              </PreviewGrupo>

              <PreviewGrupo titulo="Mascota">
                <PreviewDato label="Nombre" valor={c.nombre_mascota} falta={faltan.has('nombre_mascota')} />
                <PreviewDato label="Especie" valor={c.especie} falta={faltan.has('especie')} />
                <PreviewDato label="Fecha de nacimiento" valor={c.fecha_nacimiento ? fmtFecha(c.fecha_nacimiento) : ''} />
                <PreviewDato label="Fecha de defunción" valor={c.fecha_defuncion ? fmtFecha(c.fecha_defuncion) : ''} />
                <PreviewDato label="Peso declarado" valor={pesoDec > 0 ? fmtKg(pesoDec) : ''} falta={faltan.has('peso_declarado')} />
                {/* El peso de ingreso es el que manda para el precio: si la ficha
                    ya está en proceso y no lo tiene, es un pendiente, no un vacío. */}
                <PreviewDato label="Peso de ingreso" valor={pesoIng > 0 ? fmtKg(pesoIng) : ''}
                  falta={cumpleFiltro(c, 'falta_peso', ctxAlertas)}
                  alerta={cumpleFiltro(c, 'diferencia', ctxAlertas)}
                  nota={hayDiferencia ? `${pesoIng > pesoDec ? '+' : ''}${(pesoIng - pesoDec).toFixed(1).replace('.', ',')} kg vs el declarado` : undefined} />
              </PreviewGrupo>

              <PreviewGrupo titulo="Servicio">
                <PreviewDato full label="Tipo de servicio"
                  valor={c.codigo_servicio ? `${NOMBRE_MODALIDAD[(c.codigo_servicio || '').toUpperCase()] || c.tipo_servicio} (${c.codigo_servicio})` : ''}
                  falta={faltan.has('codigo_servicio')} />
                <PreviewDato label="Fecha de retiro" valor={c.fecha_retiro ? fmtFecha(c.fecha_retiro) : ''} falta={faltan.has('fecha_retiro')} />
                <PreviewDato label="Hora de retiro" valor={c.hora_retiro} />
                <PreviewDato label="Veterinaria" valor={nombreVet(c.veterinaria_id) || 'Cliente general (sin convenio)'} />
                <PreviewDato label="Tabla de precios" valor={LABEL_TIPO_PRECIOS[(c.tipo_precios || '').trim()] || (c.veterinaria_id ? 'Precios convenio' : 'Precios generales')} />
                <PreviewDato label="Cómo nos conoció" valor={labelOrigen(c.origen)} />
                <PreviewDato label="Ficha creada" valor={c.fecha_creacion ? fmtFecha(c.fecha_creacion) : ''} />
              </PreviewGrupo>

              <PreviewGrupo titulo="Pago">
                <PreviewDato label="Forma de pago" valor={c.tipo_pago} falta={faltan.has('tipo_pago')} />
                <PreviewDato label="Estado de pago" valor={LABEL_PAGO[(c.estado_pago || '').toLowerCase()] || c.estado_pago} falta={faltan.has('estado_pago')} />
                <PreviewDato label="Fecha de pago" valor={c.fecha_pago ? fmtFecha(c.fecha_pago) : ''}
                  falta={(c.estado_pago || '').toLowerCase() === 'pagado' && !(c.fecha_pago || '').trim()} />
                <PreviewDato label="Boleta emitida" valor={c.boleta_id ? `N° ${c.boleta_id}` : ''} />
                {(c.correo_diferencia_fecha || '').trim() && (
                  <PreviewDato full label="Cobro de diferencia enviado"
                    valor={`${fmtFecha(c.correo_diferencia_fecha)}${c.correo_diferencia_monto ? ` · ${fmtPrecio(intCLP(c.correo_diferencia_monto))}` : ''}`} />
                )}
              </PreviewGrupo>

              {/* Valor a cobrar: el mismo desglose de la tarjeta (cremación +
                  adicionales + descuento + ajuste + eutanasia), que es también el
                  del encabezado de la ficha. */}
              <section className="rounded-xl border border-gray-300 overflow-hidden">
                <h3 className="flex items-center justify-between gap-2 bg-gray-50 border-b border-gray-200 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-brand">
                  <span>Valor a cobrar</span>
                  {valorFicha(c).estimado && (
                    <span className="rounded border border-amber-200 bg-amber-100 px-1.5 py-px text-[10px] font-bold normal-case tracking-normal text-amber-900"
                      title="Calculado con las tablas de precios vigentes. Se congela al registrar la ficha.">
                      estimado
                    </span>
                  )}
                </h3>
                <div className="p-3 space-y-1 bg-cream">
                  {resumen ? resumen.lineas.map((l, i) => (
                    <div key={i} className="flex justify-between gap-3 text-sm">
                      <span className={l.tono === 'verde' ? 'text-emerald-700' : l.tono === 'rojo' ? 'text-red-600' : 'text-gray-700'}>{l.nombre}</span>
                      <span className={`shrink-0 font-semibold ${l.tono === 'verde' ? 'text-emerald-700' : l.tono === 'rojo' ? 'text-red-600' : 'text-gray-900'}`}>{l.valor}</span>
                    </div>
                  )) : (
                    <p className="text-sm text-gray-500">Esta ficha todavía no tiene un valor calculado.</p>
                  )}
                  <div className="flex justify-between gap-3 border-t border-gray-300 pt-1.5 mt-1.5 text-base">
                    <span className="font-bold text-gray-800">Total</span>
                    <span className="font-extrabold text-brand">{fmtPrecio(resumen ? resumen.total : valorFicha(c).total)}</span>
                  </div>
                  {pendiente > 0 && (
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="font-semibold text-red-700">Por cobrar</span>
                      <span className="font-bold text-red-700">{fmtPrecio(pendiente)}</span>
                    </div>
                  )}
                  {devolucion > 0 && (
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="font-semibold text-violet-800">Por devolver al tutor</span>
                      <span className="font-bold text-violet-800">{fmtPrecio(devolucion)}</span>
                    </div>
                  )}
                  {resumen?.nota && <p className="text-xs font-medium text-red-700">⚠ {resumen.nota}</p>}
                </div>
              </section>

              <PreviewGrupo titulo="Proceso">
                <PreviewDato label="Estado" valor={LABEL_ESTADO[c.estado] || LABEL_ESTADO.pendiente} />
                <PreviewDato label="Ciclo de cremación" valor={c.ciclo_id ? `N° ${c.ciclo_id}` : ''} />
                <PreviewDato label="Despacho" valor={c.despacho_id ? `N° ${c.despacho_id}` : ''} />
                {String(c.omitir_evaluacion || '').toUpperCase() === 'TRUE' && (
                  <PreviewDato label="Evaluación" valor="No se le pide reseña al entregar" />
                )}
              </PreviewGrupo>

              {hayArchivos && (
                <PreviewGrupo titulo="Archivos y recuerdos">
                  {esPremiumCuadro(c) && (
                    <PreviewDato label="Foto para el cuadro" valor={nFotosCuadro > 0 ? `${nFotosCuadro} cargada${nFotosCuadro === 1 ? '' : 's'}` : ''}
                      falta={nFotosCuadro === 0} nota={nFotosCuadro === 0 ? 'La Premium incluye el cuadro conmemorativo' : undefined} />
                  )}
                  {solicitoVideo(c) && (
                    <PreviewDato label="Video del proceso" valor={nVideos > 0 ? `${nVideos} cargado${nVideos === 1 ? '' : 's'}` : ''}
                      falta={nVideos === 0} nota={nVideos === 0 ? 'El tutor lo solicitó' : undefined} />
                  )}
                  {!solicitoVideo(c) && nVideos > 0 && <PreviewDato label="Videos del servicio" valor={`${nVideos}`} />}
                  {nFotosTutor > 0 && <PreviewDato label="Fotos del tutor (certificado)" valor={`${nFotosTutor}`} />}
                  {nEvidencia > 0 && <PreviewDato label="Fotos de evidencia del peso" valor={`${nEvidencia}`} />}
                  {nEntrega > 0 && <PreviewDato label="Fotos de la entrega" valor={`${nEntrega}`} />}
                  {(memorialOk || c.memorial_publicado_at) && (
                    <PreviewDato label="Memorial en redes"
                      valor={c.memorial_publicado_at ? `Publicado el ${fmtFecha(c.memorial_publicado_at)}` : 'Autorizado por el tutor'} />
                  )}
                  {(c.memorial_comentario || '').trim() && (
                    <PreviewDato full label="Dedicatoria del tutor" valor={c.memorial_comentario} />
                  )}
                </PreviewGrupo>
              )}

              {(c.notas || '').trim() && (
                <PreviewGrupo titulo="Notas del equipo" cols={1}>
                  <p className="whitespace-pre-wrap text-sm text-gray-800">{c.notas}</p>
                </PreviewGrupo>
              )}

              {/* Pegado al pie: con la ficha completa a la vista el resumen es
                  largo, y "Abrir ficha completa" no puede quedar a un scroll. */}
              <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-col gap-3 border-t border-gray-200 bg-white px-6 py-3 sm:flex-row">
                <button
                  onClick={() => setSelected(null)}
                  className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors"
                >
                  Cerrar
                </button>
                <Link
                  href={`/clientes/${c.id}`}
                  className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-semibold text-center shadow-md transition-colors"
                >
                  Abrir ficha completa
                </Link>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Modal "Nueva ficha" */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setAdicionales([]); setShowAdicionales(false); setFormError('') }} title="Nueva ficha de mascota">
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 font-medium">
              {formError}
            </div>
          )}

          {/* Información del tutor */}
          <h3 className="text-sm font-bold text-brand">Información del tutor</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ModalField required label="Nombre tutor" value={form.nombre_tutor} onChange={v => setForm(f => ({ ...f, nombre_tutor: v }))} />
            <ModalField required type="email" label="Email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="ejemplo@correo.cl" />
            <ModalField required type="tel" label="Teléfono" value={form.telefono} onChange={v => setForm(f => ({ ...f, telefono: v.replace(/\D/g, '').slice(0, 9) }))} placeholder="9 dígitos · ej: 912345678" />
            <ModalField required label="Comuna" value={form.comuna} onChange={v => setForm(f => ({ ...f, comuna: v }))} />
          </div>
          {esComunaNoCubierta(form.comuna) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              ⚠️ <strong>{form.comuna}</strong> está fuera de nuestra cobertura de retiro a domicilio. Puedes registrar la ficha igual (por ejemplo si la mascota se acerca a Recoleta), pero ahí no coordinamos retiro.
            </div>
          )}

          <ModalAddressField required label="Dirección de retiro" value={form.direccion_retiro}
            onChange={v => setForm(f => ({ ...f, direccion_retiro: v, direccion_despacho: f.misma_direccion ? v : f.direccion_despacho }))} />

          {/* Opcional: n° de departamento/oficina cuando la dirección es un edificio,
              para que el chofer sepa exactamente dónde tocar. */}
          <ModalField label="Depto (opcional)" value={form.depto}
            onChange={v => setForm(f => ({ ...f, depto: v }))} placeholder="Ej: 402, Torre B" />

          <div className="flex items-center gap-2">
            <input type="checkbox" id="misma" checked={form.misma_direccion}
              onChange={e => setForm(f => ({ ...f, misma_direccion: e.target.checked, direccion_despacho: e.target.checked ? f.direccion_retiro : '' }))}
              className="w-4 h-4 rounded border-gray-400 text-brand focus:ring-brand" />
            <label htmlFor="misma" className="text-xs font-medium text-gray-700">Misma dirección para despacho</label>
          </div>

          {!form.misma_direccion && (
            <ModalAddressField required label="Dirección de despacho" value={form.direccion_despacho} onChange={v => setForm(f => ({ ...f, direccion_despacho: v }))} />
          )}

          {/* Información de la mascota */}
          <h3 className="text-sm font-bold text-brand pt-3 border-t border-gray-200">Información de la mascota</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ModalField required label="Nombre mascota" value={form.nombre_mascota} onChange={v => setForm(f => ({ ...f, nombre_mascota: v }))} />
            <div>
              <label className="text-xs font-semibold text-gray-700">
                Especie <span className="text-red-500">*</span>
              </label>
              <select required value={form.especie} onChange={e => {
                const esp = especies.find(es => es.nombre === e.target.value)
                setForm(f => ({ ...f, especie: e.target.value, letra_especie: esp?.letra ?? '' }))
              }} className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${!form.especie ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}>
                <option value="">Seleccionar...</option>
                {especies.map(e => <option key={e.id} value={e.nombre}>{e.nombre}</option>)}
              </select>
            </div>
            <ModalField type="date" label="Fecha de nacimiento" value={form.fecha_nacimiento} onChange={v => setForm(f => ({ ...f, fecha_nacimiento: v }))} />
            <ModalField required type="date" label="Fecha de defunción" value={form.fecha_defuncion} onChange={v => setForm(f => ({ ...f, fecha_defuncion: v }))} />
            <ModalField required type="number" step="0.1" min="0" label="Peso declarado (kg)" value={form.peso_declarado} onChange={v => setForm(f => ({ ...f, peso_declarado: v }))} />
          </div>

          {/* Información del servicio */}
          <h3 className="text-sm font-bold text-brand pt-3 border-t border-gray-200">Información del servicio</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ModalField required type="date" label="Fecha de retiro" value={form.fecha_retiro} onChange={v => setForm(f => ({ ...f, fecha_retiro: v }))} />
            <ModalField type="time" label="Hora de retiro" value={form.hora_retiro} onChange={v => setForm(f => ({ ...f, hora_retiro: v }))} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700">
              Tipo de servicio <span className="text-red-500">*</span>
            </label>
            <select required value={form.codigo_servicio} onChange={e => {
              const codigo = e.target.value
              const svc = SERVICIOS.find(s => s.codigo === codigo)
              // En Sin Devolución no hay despacho posterior, así que la dirección de
              // despacho equivale a la de retiro: auto-marcamos misma_direccion para
              // ahorrar el segundo campo.
              const esSinDev = codigo === 'SD'
              setForm(f => ({
                ...f,
                codigo_servicio: codigo,
                tipo_servicio: svc?.nombre ?? '',
                misma_direccion: esSinDev ? true : f.misma_direccion,
                direccion_despacho: esSinDev ? f.direccion_retiro : f.direccion_despacho,
              }))
            }} className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              {SERVICIOS.map(s => <option key={s.codigo} value={s.codigo}>{s.nombre} ({s.codigo})</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t-2 border-gray-300">
            <div>
              <label className="text-xs font-semibold text-gray-700">
                Tipo de pago <span className="text-red-500">*</span>
              </label>
              <select required value={form.tipo_pago} onChange={e => setForm(f => ({ ...f, tipo_pago: e.target.value }))}
                className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${!form.tipo_pago ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}>
                <option value="">Seleccionar...</option>
                <option value="transferencia">Transferencia</option>
                <option value="pos">POS</option>
                <option value="efectivo">Efectivo</option>
                <option value="link">Link de pago</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">
                Estado de pago <span className="text-red-500">*</span>
              </label>
              {/* Al marcarla pagada proponemos hoy como fecha de cobro: es con la que
                  Facturación → Ventas POS arma el día y cuadra el abono de Haulmer. */}
              <select required value={form.estado_pago}
                onChange={e => setForm(f => ({
                  ...f,
                  estado_pago: e.target.value,
                  fecha_pago: e.target.value === 'pagado' && !f.fecha_pago ? todayISO() : f.fecha_pago,
                }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="pendiente">Pendiente de pago</option>
                <option value="parcial">Pago parcial</option>
                <option value="pagado">Pagado</option>
              </select>
            </div>
            {/* La FECHA DE PAGO no se muestra (decisión del dueño): se guarda sola
                —hoy al marcar la ficha pagada, y el servidor la sella si llegara
                vacía— porque Facturación → Ventas POS la necesita para armar el
                día y cuadrar el abono de Haulmer. Sigue viajando en el form. */}
            {/* Origen: con esto sabemos cuánto cuesta de verdad traer un cliente por
                canal (inversión del canal ÷ fichas de ese canal). Las fichas que nacen
                del agente de WhatsApp ya vienen marcadas solas. */}
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-gray-700">¿Cómo nos conoció?</label>
              <select value={form.origen} onChange={e => setForm(f => ({ ...f, origen: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="">Sin registrar</option>
                {ORIGENES_MANUALES.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Pago parcial: box para indicar cuánto abonó → queda un saldo pendiente. */}
          {form.estado_pago === 'parcial' && (() => {
            const abonoNum = parseInt((abonoNueva || '').replace(/\D/g, ''), 10) || 0
            const pendiente = Math.max(0, Math.round(totalServicio) - abonoNum)
            return (
              <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  <div>
                    <label className="text-xs font-semibold text-gray-700">¿Cuánto pagó? (abono)</label>
                    <input
                      type="number" min={0} inputMode="numeric" value={abonoNueva}
                      onChange={e => setAbonoNueva(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div className="text-sm">
                    <p className="text-xs text-gray-600">Total del servicio: <span className="font-semibold text-gray-900">{fmtPrecio(Math.round(totalServicio))}</span></p>
                    <p className="mt-0.5 text-amber-900 font-bold">Pendiente por pagar: {fmtPrecio(pendiente)}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-amber-800">
                  Al crear la ficha queda un <strong>saldo pendiente</strong> por la diferencia (aparece en «pago pendiente»). La boleta se emite recién cuando confirmes el pago total.
                </p>
              </div>
            )
          })()}

          {/* Veterinaria derivante (lógica invertida) */}
          <div className="border-t-2 border-gray-300 pt-4">
            <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
              <input
                type="checkbox"
                checked={esClienteVet}
                onChange={e => {
                  setEsClienteVet(e.target.checked)
                  if (!e.target.checked) setForm(f => ({ ...f, veterinaria_id: '' }))
                }}
                className="w-4 h-4 rounded border-gray-400 text-brand focus:ring-brand"
              />
              <span className="text-xs font-semibold text-gray-700">Cliente de veterinaria</span>
            </label>
            {esClienteVet && (
              <select value={form.veterinaria_id} onChange={e => setForm(f => ({ ...f, veterinaria_id: e.target.value }))}
                className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="">Seleccionar veterinaria...</option>
                {veterinarias.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            )}
          </div>

          {/* Adicionales */}
          {(productosDisp.length > 0 || otrosServicios.length > 0) && (
            <div className="border-t-2 border-gray-300">
              <button
                type="button"
                onClick={() => setShowAdicionales(v => !v)}
                className="w-full flex items-center justify-between py-3 text-left hover:bg-gray-50 px-1 rounded transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-700">Adicionales</span>
                  {adicionales.length > 0 && (
                    <span className="bg-brand/10 text-brand text-xs font-semibold px-2 py-0.5 rounded-full">
                      {adicionales.length} ítem(s) · {fmtPrecio(totalAdicionales)}
                    </span>
                  )}
                </div>
                <span className="text-gray-400 text-xs">{showAdicionales ? '▲' : '▼'}</span>
              </button>

              {showAdicionales && (
                <div className="pb-3">
                  {productosDisp.length > 0 && (() => {
                    // Agrupados por categoría (mismo orden que en Configuración).
                    const grupos = new Map<string, Producto[]>()
                    for (const p of productosDisp) {
                      const cat = (p.categoria ?? '').trim() || 'Sin categoría'
                      const arr = grupos.get(cat) ?? []
                      arr.push(p)
                      grupos.set(cat, arr)
                    }
                    const orden = Array.from(grupos.keys()).sort((a, b) => {
                      if (a === 'Sin categoría') return 1
                      if (b === 'Sin categoría') return -1
                      return a.localeCompare(b)
                    })
                    return (
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Productos</p>
                        {servicioIncluyeAnforaPremium(form.codigo_servicio) && (
                          <p className="mb-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1.5">
                            Cremación Premium incluye un ánfora premium sin costo: al elegirla queda en $0 y se descuenta del stock igual.
                          </p>
                        )}
                        <div className="space-y-3">
                          {orden.map(cat => {
                            const itemsCat = grupos.get(cat)!
                            const abierta = catsAbiertas.has(cat)
                            const elegidos = itemsCat.filter(pp => adicionales.some(a => a.tipo === 'producto' && a.id === pp.id))
                            // Colapsada: solo los productos ya seleccionados (si hay).
                            const visibles = abierta ? itemsCat : elegidos
                            return (
                            <div key={cat}>
                              <button type="button" onClick={() => toggleCat(cat)}
                                className="w-full flex items-center justify-between gap-2 mb-1.5 border-b border-brand/20 pb-1 text-left hover:bg-gray-50 rounded transition-colors">
                                <span className="text-[11px] font-bold text-brand uppercase tracking-wide">{cat}</span>
                                <span className="flex items-center gap-2">
                                  {elegidos.length > 0 && (
                                    <span className="text-[10px] font-semibold text-brand bg-brand/10 rounded-full px-1.5 py-0.5">{elegidos.length} elegido(s)</span>
                                  )}
                                  <span className="text-[10px] text-gray-400">{itemsCat.length} producto(s)</span>
                                  <span className="text-gray-400 text-xs">{abierta ? '▲' : '▼'}</span>
                                </span>
                              </button>
                              {visibles.length > 0 && (
                              <div className="space-y-1.5 pl-1">
                                {visibles.map(p => {
                                  const item = adicionales.find(a => a.tipo === 'producto' && a.id === p.id)
                                  const stockNum = parseInt(p.stock || '0')
                                  const sinStock = stockNum <= 0
                                  const incluido = anforaPremiumIncluida(form.codigo_servicio, p.categoria)
                                  return (
                                    <div key={p.id} className={`flex items-center gap-2 ${sinStock ? 'opacity-50' : ''}`}>
                                      <input type="checkbox" checked={!!item} disabled={sinStock && !item}
                                        onChange={() => toggleAdicional('producto', p)}
                                        className="w-3.5 h-3.5 rounded border-gray-400 text-brand focus:ring-brand disabled:cursor-not-allowed" />
                                      <span className={`flex-1 text-sm ${sinStock ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{p.nombre}</span>
                                      {incluido ? (
                                        <span className="text-xs font-semibold text-emerald-600">Incluida{p.precio && parseFloat(p.precio) > 0 ? <span className="ml-1 text-gray-400 font-normal line-through">{fmtPrecio(p.precio)}</span> : null}</span>
                                      ) : (
                                        <span className={`text-xs ${sinStock ? 'text-gray-400 line-through' : 'text-gray-500'}`}>{fmtPrecio(p.precio)}</span>
                                      )}
                                      {sinStock && <span className="text-[10px] text-red-600 font-semibold">sin stock</span>}
                                      {item && !sinStock && (
                                        <input type="number" min={1} value={item.qty} onChange={e => updateQty('producto', p.id, parseInt(e.target.value) || 1)}
                                          className="w-14 border-2 border-gray-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-brand" />
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                              )}
                            </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  {otrosServicios.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Otros servicios</p>
                      <div className="space-y-1.5">
                        {otrosServicios.map(s => {
                          const item = adicionales.find(a => a.tipo === 'servicio' && a.id === s.id)
                          return (
                            <div key={s.id} className="flex items-center gap-2">
                              <input type="checkbox" checked={!!item} onChange={() => toggleAdicional('servicio', s)} className="w-3.5 h-3.5 rounded border-gray-400 text-brand focus:ring-brand" />
                              <span className="flex-1 text-sm text-gray-800">{s.nombre}</span>
                              {!!item && autoAgregadosRef.current.has(s.id) && (
                                <span title={etiquetaRegla(s.auto_regla)} className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">auto</span>
                              )}
                              <span className="text-xs text-gray-500">{fmtPrecio(s.precio)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Resumen del servicio en vivo: se actualiza con peso, servicio, veterinaria y adicionales */}
          <div className="border-t-2 border-gray-300 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-900">Resumen del servicio</p>
              <span className="text-[11px] text-gray-400">{tablaNombre}</span>
            </div>
            <div className="bg-gray-50 rounded-lg border border-gray-300 p-3 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    Cremación {codigoServForm}
                    {rangoTramo && <span className="text-gray-500 font-normal"> · {rangoTramo}</span>}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {pesoKgForm > 0 ? `${pesoKgForm} kg` : 'Ingresa el peso para calcular'}
                    {pesoKgForm > 0 && !tramoAplicable && (
                      <span className="text-red-500 ml-2">⚠ Sin tramo de precio aplicable</span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">{fmtPrecio(precioServicio)}</p>
                  {mostrarPrecioNormal && (
                    <p className="text-xs text-gray-500 mt-0.5">(precio normal: {fmtPrecio(precioNormal)})</p>
                  )}
                </div>
              </div>

              {adicionales.length > 0 && (
                <div className="border-t border-gray-300 pt-2 space-y-1">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Adicionales</p>
                  {adicionales.map((a, i) => {
                    const r = repartoAdic[i]
                    const monto = Math.max(0, a.precio) * r.qtyCobrable
                    return (
                    <div key={`${a.tipo}-${a.id}`} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">
                        {a.nombre}{a.qty > 1 && <span className="text-gray-400"> × {a.qty}</span>}
                      </span>
                      {r.qtyIncluida > 0 && r.qtyCobrable === 0
                        ? <span className="font-medium text-emerald-600">Incluida</span>
                        : r.qtyIncluida > 0
                          ? <span className="text-gray-700"><span className="font-medium text-emerald-600">{r.qtyIncluida} incluida</span> · {fmtPrecio(monto)}</span>
                          : <span className="text-gray-700">{fmtPrecio(monto)}</span>}
                    </div>
                    )
                  })}
                  <div className="flex items-center justify-between pt-1 border-t border-gray-300">
                    <span className="text-xs text-gray-500">Subtotal adicionales</span>
                    <span className="text-sm font-medium text-gray-700">{fmtPrecio(totalAdicionales)}</span>
                  </div>
                </div>
              )}

              <div className="border-t border-gray-300 pt-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={aplicarDescuento}
                    onChange={e => {
                      setAplicarDescuento(e.target.checked)
                      if (!e.target.checked) setDescuentoId('')
                    }}
                    className="w-4 h-4 rounded border-gray-400 text-brand focus:ring-brand"
                  />
                  <span className="text-sm font-medium text-gray-700">Aplicar descuento</span>
                </label>
                {aplicarDescuento && (
                  <div className="mt-2 space-y-2">
                    <select
                      value={descuentoId}
                      onChange={e => setDescuentoId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      <option value="">— Seleccionar descuento —</option>
                      {descuentosDisp.map(d => {
                        const v = parseFloat(d.valor) || 0
                        const etiqueta = d.tipo === 'fijo' ? fmtPrecio(v) : `${v}%`
                        return (
                          <option key={d.id} value={d.id}>{d.nombre} — {etiqueta}</option>
                        )
                      })}
                    </select>
                    {descuentoElegido && montoDescuento > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">
                          {descuentoElegido.nombre}
                          <span className="text-gray-400 ml-1">({descuentoEtiqueta})</span>
                        </span>
                        <span className="font-semibold text-red-600">− {fmtPrecio(montoDescuento)}</span>
                      </div>
                    )}
                    {descuentosDisp.length === 0 && (
                      <p className="text-xs text-gray-400">No hay descuentos activos. Ve a Configuración → Descuentos para crear uno.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t-2 border-gray-300 pt-2 mt-1">
                <span className="text-base font-bold text-gray-900">Total</span>
                <span className="text-lg font-bold text-brand">{fmtPrecio(totalServicio)}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowModal(false); setAdicionales([]); setShowAdicionales(false); setAplicarDescuento(false); setDescuentoId(''); setFormError('') }} className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar ficha'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal de éxito post-guardar: muestra código generado + resumen para el operador */}
      <Modal open={!!fichaCreada} onClose={() => setFichaCreada(null)} title="Ficha creada ✓">
        {fichaCreada && (
          <div className="space-y-4">
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Código generado</p>
              <p className="font-mono text-2xl font-bold text-emerald-900 mt-1">{fichaCreada.codigo}</p>
              <p className="text-sm text-emerald-800 mt-2">{fichaCreada.nombre_mascota} · {fichaCreada.nombre_tutor}</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-gray-900">Resumen del servicio</p>
                <span className="text-[11px] text-gray-400">{fichaCreada.tabla_nombre}</span>
              </div>
              <div className="bg-gray-50 rounded-lg border border-gray-300 p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      Cremación {fichaCreada.codigo_servicio}
                      {fichaCreada.rango_tramo && <span className="text-gray-500 font-normal"> · {fichaCreada.rango_tramo}</span>}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{fichaCreada.peso_kg} kg</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">{fmtPrecio(fichaCreada.precio_servicio)}</p>
                    {fichaCreada.mostrar_precio_normal && (
                      <p className="text-xs text-gray-500 mt-0.5">(precio normal: {fmtPrecio(fichaCreada.precio_normal)})</p>
                    )}
                  </div>
                </div>

                {fichaCreada.adicionales.length > 0 && (() => {
                  const repFC = repartirAnforasPremium(
                    fichaCreada.codigo_servicio, fichaCreada.adicionales,
                    new Map(productosDisp.map(p => [String(p.id), String(p.categoria ?? '')])),
                  )
                  return (
                  <div className="border-t border-gray-300 pt-2 space-y-1">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Adicionales</p>
                    {fichaCreada.adicionales.map((a, i) => {
                      const r = repFC[i]
                      const monto = Math.max(0, a.precio) * r.qtyCobrable
                      return (
                        <div key={`${a.tipo}-${a.id}`} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700">
                            {a.nombre}{a.qty > 1 && <span className="text-gray-400"> × {a.qty}</span>}
                          </span>
                          {r.qtyIncluida > 0 && r.qtyCobrable === 0
                            ? <span className="font-medium text-emerald-600">Incluida</span>
                            : r.qtyIncluida > 0
                              ? <span className="text-gray-700"><span className="font-medium text-emerald-600">{r.qtyIncluida} incluida</span> · {fmtPrecio(monto)}</span>
                              : <span className="text-gray-700">{fmtPrecio(monto)}</span>}
                        </div>
                      )
                    })}
                    <div className="flex items-center justify-between pt-1 border-t border-gray-300">
                      <span className="text-xs text-gray-500">Subtotal adicionales</span>
                      <span className="text-sm font-medium text-gray-700">{fmtPrecio(fichaCreada.total_adicionales)}</span>
                    </div>
                  </div>
                  )
                })()}

                {fichaCreada.descuento_monto > 0 && (
                  <div className="flex items-center justify-between border-t border-gray-300 pt-2 text-sm">
                    <span className="text-gray-700">
                      {fichaCreada.descuento_nombre}
                      <span className="text-gray-400 ml-1">({fichaCreada.descuento_etiqueta})</span>
                    </span>
                    <span className="font-semibold text-red-600">− {fmtPrecio(fichaCreada.descuento_monto)}</span>
                  </div>
                )}

                <div className="flex items-center justify-between border-t-2 border-gray-300 pt-2 mt-1">
                  <span className="text-base font-bold text-gray-900">Total a cobrar</span>
                  <span className="text-xl font-bold text-brand">{fmtPrecio(fichaCreada.total)}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setFichaCreada(null)}
              className="w-full bg-brand hover:bg-brand-dark text-white rounded-lg py-2.5 text-sm font-semibold shadow-md transition-colors"
            >
              Listo
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}

/**
 * Un bloque del resumen de la ficha. Mismos grupos que la ficha completa, para
 * que quien pasa de uno al otro busque cada dato en el mismo lugar.
 */
function PreviewGrupo({ titulo, cols = 2, children }: { titulo: string; cols?: 1 | 2; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-300 overflow-hidden">
      <h3 className="bg-gray-50 border-b border-gray-200 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-brand">{titulo}</h3>
      <div className={`p-3 grid grid-cols-1 gap-x-4 gap-y-3 ${cols === 2 ? 'sm:grid-cols-2' : ''}`}>{children}</div>
    </section>
  )
}

/**
 * Un dato del resumen. La distinción importa: `falta` es un campo que la ficha
 * NECESITA y no tiene (sale "Falta" en rojo), mientras que un opcional vacío
 * sale como un guion gris. `alerta` pinta en rojo un valor que sí está pero
 * exige atención (el correo que rebota, el peso que cambió de tramo).
 */
function PreviewDato({ label, valor, falta = false, alerta = false, nota, full = false }: {
  label: string; valor?: string | null; falta?: boolean; alerta?: boolean; nota?: string; full?: boolean
}) {
  const vacio = !valor || !String(valor).trim()
  const rojo = falta || alerta
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-0.5 text-sm font-medium break-words ${rojo ? 'text-red-700' : vacio ? 'text-gray-400' : 'text-gray-900'}`}>
        {vacio ? (falta ? 'Falta' : '—') : valor}
      </p>
      {nota && <p className={`mt-0.5 text-[11px] ${rojo ? 'text-red-600' : 'text-gray-500'}`}>{nota}</p>}
    </div>
  )
}

function ModalField({ label, value, onChange, type = 'text', step, min, required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; step?: string; min?: string; required?: boolean; placeholder?: string
}) {
  const faltante = required && !value.trim()
  return (
    <div>
      <label className="text-xs font-semibold text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        step={step}
        min={min}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${
          faltante ? 'border-red-300 bg-red-50' : 'border-gray-300'
        }`}
      />
    </div>
  )
}

function ModalAddressField({ label, value, onChange, required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  required?: boolean; placeholder?: string
}) {
  const faltante = required && !value.trim()
  return (
    <div>
      <label className="text-xs font-semibold text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="mt-1">
        <AddressAutocomplete
          value={value}
          onChange={onChange}
          required={required}
          placeholder={placeholder ?? 'Empieza a escribir la dirección…'}
          className={`w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${
            faltante ? 'border-red-300 bg-red-50' : 'border-gray-300'
          }`}
        />
      </div>
    </div>
  )
}
