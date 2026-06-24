'use client'
import { useCallback, useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { fmtPrecio, fmtFecha } from '@/lib/format'
import { formatDateForSheet } from '@/lib/dates'

type Cliente = {
  id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  especie: string; peso_declarado?: string; peso_ingreso?: string; codigo_servicio: string; estado: string
  fecha_creacion: string; fecha_retiro?: string
}

type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string }

type VetDetalle = {
  id: string; nombre: string; rut: string; razon_social: string; giro: string
  direccion: string; telefono: string; correo: string
  nombre_contacto: string; cargo_contacto: string; comuna: string
  tipo_precios: string; activo: string
  clientes: Cliente[]
  tramos_especiales: Tramo[]
}

type InformeEmitido = {
  id: string
  veterinaria_id: string
  version: string
  formato: 'excel' | 'pdf' | string
  periodo_hasta_mes: string
  cantidad_meses: string
  cantidad_fichas: string
  monto_total_clp: string
  fecha_emision: string
  hora_emision: string
  emitido_por_nombre: string
  archivo_url: string
}

export default function VetDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [vet, setVet] = useState<VetDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [generandoExcel, setGenerandoExcel] = useState(false)
  const [generandoPdf, setGenerandoPdf] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const [informesEmitidos, setInformesEmitidos] = useState<InformeEmitido[]>([])
  const [verHistorico, setVerHistorico] = useState(false)

  const fetchInformes = useCallback(async () => {
    const r = await fetch(`/api/veterinarios/${id}/informes`).catch(() => null)
    if (!r || !r.ok) return
    const data = await r.json().catch(() => [])
    setInformesEmitidos(Array.isArray(data) ? data : [])
  }, [id])

  useEffect(() => {
    fetch(`/api/veterinarios/${id}`)
      .then(r => r.json())
      .then(d => { setVet(d); setLoading(false) })
    fetchInformes()
  }, [id, fetchInformes])

  function copiarEmail() {
    if (vet?.correo) {
      navigator.clipboard.writeText(vet.correo)
      alert(`Email copiado: ${vet.correo}`)
    }
  }

  async function generarInforme(formato: 'excel' | 'pdf') {
    setFeedback(null)
    const setBusy = formato === 'excel' ? setGenerandoExcel : setGenerandoPdf
    setBusy(true)
    try {
      const res = await fetch(`/api/veterinarios/${id}/informe/${formato}`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setFeedback({ kind: 'error', msg: err?.error ?? 'No se pudo generar el informe' })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const ext = formato === 'excel' ? 'xlsx' : 'pdf'
      a.href = url
      a.download = `Informe_${(vet?.nombre || 'vet').replace(/\s+/g, '_')}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      await fetchInformes()
      setFeedback({ kind: 'ok', msg: `${formato.toUpperCase()} generado y registrado` })
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'Error al generar' })
    } finally {
      setBusy(false)
    }
  }

  async function enviarUltimoInforme() {
    setFeedback(null)
    setEnviando(true)
    try {
      const res = await fetch(`/api/veterinarios/${id}/informe/enviar`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFeedback({ kind: 'error', msg: data?.error ?? 'No se pudo enviar el informe' })
        return
      }
      setFeedback({ kind: 'ok', msg: `Informe enviado a ${data.to} (v${data.version_enviada} ${data.formato})` })
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'Error al enviar' })
    } finally {
      setEnviando(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Cargando...</div>
  if (!vet) return <div className="p-8 text-gray-400 text-sm">Veterinaria no encontrada</div>

  const cremadas = vet.clientes.filter(c => c.estado === 'cremado').length
  const despachadas = vet.clientes.filter(c => c.estado === 'despachado').length
  const retiradas = vet.clientes.filter(c => c.estado === 'pendiente' || !c.estado).length
  const ultimoInforme = informesEmitidos[0]

  // Sheets devuelve fechas y horas como seriales/fracciones de día con UNFORMATTED_VALUE.
  // Estos helpers las formatean a strings legibles.
  function fmtHoraEmision(raw: string): string {
    if (!raw) return ''
    const n = parseFloat(raw)
    if (Number.isFinite(n) && n >= 0 && n < 1) {
      // Fracción de día (ej 0.99375 = 23:51)
      const totalMin = Math.round(n * 24 * 60)
      const h = Math.floor(totalMin / 60) % 24
      const m = totalMin % 60
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
    return raw
  }
  function fmtPeriodoHasta(raw: string): string {
    if (!raw) return '—'
    // Caso ISO directo "YYYY-MM"
    if (/^\d{4}-\d{2}$/.test(raw)) {
      const [y, m] = raw.split('-').map(Number)
      const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
      return `${MESES[m - 1]} ${y}`
    }
    // Caso serial Excel (ej. 46143 = 2026-04-30)
    const iso = formatDateForSheet(raw)
    if (iso) {
      const d = new Date(`${iso}T12:00:00`)
      if (!isNaN(d.getTime())) {
        const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
        return `${MESES[d.getMonth()]} ${d.getFullYear()}`
      }
    }
    return raw
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">←</button>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold text-brand tracking-tight">{vet.nombre}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={vet.tipo_precios === 'precios_especiales' ? 'purple' : 'blue'}>
              {vet.tipo_precios === 'precios_especiales' ? 'Convenio especial' : 'Convenio estándar'}
            </Badge>
            <Badge variant={vet.activo === 'TRUE' ? 'green' : 'yellow'}>
              {vet.activo === 'TRUE' ? 'Activa' : 'Inactiva'}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={copiarEmail} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
            📋 Copiar email
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-md border border-gray-300 p-5 text-center">
          <p className="text-3xl font-bold text-brand">{vet.clientes.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total mascotas</p>
        </div>
        <div className="bg-white rounded-xl shadow-md border border-gray-300 p-5 text-center">
          <p className="text-3xl font-bold text-amber-600">{retiradas}</p>
          <p className="text-xs text-gray-500 mt-1">Retiradas</p>
        </div>
        <div className="bg-white rounded-xl shadow-md border border-gray-300 p-5 text-center">
          <p className="text-3xl font-bold text-emerald-600">{cremadas}</p>
          <p className="text-xs text-gray-500 mt-1">Cremadas</p>
        </div>
        <div className="bg-white rounded-xl shadow-md border border-gray-300 p-5 text-center">
          <p className="text-3xl font-bold text-blue-600">{despachadas}</p>
          <p className="text-xs text-gray-500 mt-1">Despachadas</p>
        </div>
      </div>

      {/* Informes de facturación */}
      <div className="bg-white rounded-xl shadow-md border border-gray-300 mb-6 overflow-hidden">
        <div className="bg-gradient-to-r from-brand/10 to-purple-50 px-6 py-3 border-b border-brand/20 flex items-center gap-2">
          <span className="text-lg">📊</span>
          <h2 className="text-sm font-bold text-brand uppercase tracking-wide">Informes de facturación</h2>
        </div>
        <div className="p-6">
          <p className="text-xs text-gray-600 mb-4 leading-relaxed">
            Genera el informe acumulado de facturación. Incluye todas las fichas desde el primer registro
            hasta el fin del mes anterior, con desglose mensual y semanal. El mes en curso no se incluye
            hasta que termine para que el monto sea estable.
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => generarInforme('excel')}
              disabled={generandoExcel || generandoPdf}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {generandoExcel ? '⌛ Generando Excel…' : '📗 Generar Excel'}
            </button>
            <button
              onClick={() => generarInforme('pdf')}
              disabled={generandoExcel || generandoPdf}
              className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {generandoPdf ? '⌛ Generando PDF…' : '📕 Generar PDF'}
            </button>
            <button
              onClick={enviarUltimoInforme}
              disabled={enviando || !ultimoInforme || !vet.correo}
              title={!vet.correo ? 'La veterinaria no tiene email' : !ultimoInforme ? 'Generá un informe primero' : `Enviar a ${vet.correo}`}
              className="inline-flex items-center gap-2 bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {enviando ? '⌛ Enviando…' : '📧 Enviar último al correo'}
            </button>
            <button
              onClick={() => setVerHistorico(v => !v)}
              disabled={informesEmitidos.length === 0}
              className="inline-flex items-center gap-2 border-2 border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {verHistorico ? '▲ Ocultar informes anteriores' : `▼ Ver informes anteriores${informesEmitidos.length > 0 ? ` (${informesEmitidos.length})` : ''}`}
            </button>
          </div>

          {feedback && (
            <div className={`rounded-lg px-3 py-2 text-xs font-medium border mb-4 ${
              feedback.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              {feedback.msg}
            </div>
          )}

          {verHistorico && (
            informesEmitidos.length > 0 ? (
              <div className="border border-gray-300 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-300">
                  <p className="text-xs font-semibold text-gray-600">Histórico de informes emitidos para esta veterinaria</p>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-white">
                    <tr>
                      {['Versión', 'Formato', 'Emitido', 'Período hasta', 'Fichas', 'Por', ''].map(h => (
                        <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-gray-500 border-b border-gray-300">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {informesEmitidos.map(inf => (
                      <tr key={inf.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs font-bold text-brand">v{inf.version}</td>
                        <td className="px-4 py-2 text-gray-700">
                          <Badge variant={inf.formato === 'pdf' ? 'red' : 'green'}>{inf.formato.toUpperCase()}</Badge>
                        </td>
                        <td className="px-4 py-2 text-gray-700 whitespace-nowrap">
                          {fmtFecha(inf.fecha_emision)}
                          {inf.hora_emision && <span className="text-gray-400"> · {fmtHoraEmision(inf.hora_emision)}</span>}
                        </td>
                        <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{fmtPeriodoHasta(inf.periodo_hasta_mes)}</td>
                        <td className="px-4 py-2 text-gray-700">{inf.cantidad_fichas}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{inf.emitido_por_nombre || '—'}</td>
                        <td className="px-4 py-2">
                          {inf.archivo_url ? (
                            <a href={inf.archivo_url} target="_blank" rel="noopener noreferrer"
                              className="bg-brand hover:bg-brand-dark text-white px-3 py-1 rounded-md text-xs font-semibold">
                              Descargar
                            </a>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">Aún no se ha emitido ningún informe para esta veterinaria.</p>
            )
          )}
        </div>
      </div>

      {/* Datos */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-md border border-gray-300 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Datos generales</h2>
          <div className="space-y-3 text-sm">
            {[
              ['RUT', vet.rut],
              ['Razón social', vet.razon_social],
              ['Giro', vet.giro],
              ['Dirección', vet.direccion],
              ['Comuna', vet.comuna],
            ].map(([label, val]) => val ? (
              <div key={label} className="flex justify-between gap-2">
                <span className="text-gray-500">{label}</span>
                <span className="text-gray-900 text-right">{val}</span>
              </div>
            ) : null)}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-md border border-gray-300 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Contacto</h2>
          <div className="space-y-3 text-sm">
            {[
              ['Teléfono', vet.telefono],
              ['Email', vet.correo],
              ['Contacto', vet.nombre_contacto],
              ['Cargo', vet.cargo_contacto],
            ].map(([label, val]) => val ? (
              <div key={label} className="flex justify-between gap-2">
                <span className="text-gray-500">{label}</span>
                <span className="text-gray-900 text-right">{val}</span>
              </div>
            ) : null)}
          </div>
        </div>
      </div>

      {/* Precios especiales */}
      {vet.tramos_especiales.length > 0 && (
        <div className="bg-white rounded-xl shadow-md border border-gray-300 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-300">
            <h2 className="font-semibold text-gray-900">Tramos de precio especial</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Peso mín', 'Peso máx', 'CI', 'CP', 'SD'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {vet.tramos_especiales.map(t => (
                <tr key={t.id}>
                  <td className="px-4 py-2 text-gray-600">{t.peso_min} kg</td>
                  <td className="px-4 py-2 text-gray-600">{t.peso_max} kg</td>
                  <td className="px-4 py-2 font-medium">{fmtPrecio(t.precio_ci)}</td>
                  <td className="px-4 py-2 font-medium">{fmtPrecio(t.precio_cp)}</td>
                  <td className="px-4 py-2 font-medium">{fmtPrecio(t.precio_sd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lista de mascotas */}
      <div className="bg-white rounded-xl shadow-md border border-gray-300 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-300">
          <h2 className="font-semibold text-gray-900">Mascotas ingresadas</h2>
        </div>
        {vet.clientes.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin mascotas registradas para esta veterinaria</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Código', 'Mascota', 'Tutor', 'Especie', 'Servicio', 'Estado', 'Fecha'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {vet.clientes.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-brand font-semibold">{c.codigo}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.nombre_mascota}</td>
                  <td className="px-4 py-3 text-gray-600">{c.nombre_tutor}</td>
                  <td className="px-4 py-3 text-gray-600">{c.especie}</td>
                  <td className="px-4 py-3"><span className="font-mono font-semibold text-xs text-gray-700">{c.codigo_servicio}</span></td>
                  <td className="px-4 py-3"><Badge variant={c.estado === 'cremado' ? 'green' : c.estado === 'despachado' ? 'blue' : 'yellow'}>{c.estado && c.estado !== 'pendiente' ? c.estado : 'retirado'}</Badge></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmtFecha(c.fecha_retiro || c.fecha_creacion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
