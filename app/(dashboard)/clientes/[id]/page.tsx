'use client'
import { useState, useEffect, use, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import { fmtLitros, fmtPrecio, fmtFecha } from '@/lib/format'
import { formatDateForSheet } from '@/lib/dates'
import { parsePeso } from '@/lib/numbers'
import { findTramo, precioDelTramo } from '@/lib/tramos'
import { anforaPremiumIncluida, servicioIncluyeAnforaPremium } from '@/lib/anforas-premium'
import { aplicaReglaAuto } from '@/lib/adicionales-auto'
import { esAdmin } from '@/lib/roles'

type Certificado = {
  id: string
  cliente_id: string
  version: string
  fecha_emision: string
  hora_emision: string
  pdf_url: string
  emitido_por_nombre: string
  sin_foto: string
  enviado_ultima_fecha?: string
  enviado_ultima_hora?: string
  enviado_cantidad?: string
  enviado_a?: string
}

type CorreoCliente = {
  id: string
  cliente_id: string
  tipo: string
  email: string
  estado: string
  motivo: string
  fecha_envio: string
  fecha_actualizacion: string
}

type AdicionalItem = { tipo: 'producto' | 'servicio'; id: string; nombre: string; precio: number; qty: number }

type Cobro = { id: string; cliente_id: string; tipo: string; detalle: string; monto: string; estado: string; fecha_creacion: string }

type Descuento = { id: string; nombre: string; tipo: string; valor: string; activo: string }

type ClienteDetalle = {
  id: string
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  email: string
  telefono: string
  direccion_retiro: string
  direccion_despacho: string
  misma_direccion: string
  comuna: string
  fecha_retiro: string
  hora_retiro?: string
  especie: string
  letra_especie: string
  peso_declarado: string
  peso_ingreso: string
  despacho_id: string
  tipo_servicio: string
  codigo_servicio: string
  estado: string
  ciclo_id: string
  veterinaria_id: string
  tipo_precios: string
  adicionales: string
  descuento_id?: string
  descuento_nombre?: string
  descuento_tipo?: string
  descuento_valor?: string
  descuento_monto?: string
  fecha_creacion: string
  fecha_defuncion: string
  notas: string
  tipo_pago: string
  estado_pago: string
  precio_total?: string
  boleta_id?: string
  omitir_evaluacion?: string
  fotos_mascota?: string
  fotos_cuadro?: string
  videos_servicio?: string
  fotos_evidencia?: string
  correo_diferencia_fecha?: string
  correo_diferencia_monto?: string
  cobros?: Cobro[]
  ciclo?: {
    id: string
    fecha: string
    numero_ciclo: string
    litros_inicio: string
    litros_fin: string
    comentarios: string
  } | null
  despacho?: {
    id: string
    fecha: string
    numero_recorrido: string
    numero_global: string
    nota: string
  } | null
  /** Eutanasia a domicilio asociada (si la ficha vino de ese flujo). El valor se
   *  cobra aparte y NO va en la boleta (esa es solo por la cremación). */
  eutanasia?: {
    id: string
    hora_servicio: string
    hora_retiro_crematorio: string
    estado: string
    valor_cliente: number
  } | null
}

type Veterinario = { id: string; nombre: string; activo: string; tipo_precios: string }
type Especie = { id: string; nombre: string; letra: string; activo: string }
type Producto = { id: string; nombre: string; precio: string; stock: string; categoria?: string; activo: string }
type OtroServicio = { id: string; nombre: string; precio: string; activo: string; auto_regla?: string; comunas?: string }
type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string }
type TramoEspecial = Tramo & { veterinaria_id: string }

export default function ClienteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { data: session } = useSession()
  const isAdmin = esAdmin((session?.user as { role?: string })?.role)
  const [cliente, setCliente] = useState<ClienteDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [descargandoCert, setDescargandoCert] = useState(false)
  const [showCertModal, setShowCertModal] = useState(false)
  const [certFoto, setCertFoto] = useState<File | null>(null)
  // URL de una foto que el tutor subió (desde /subir-foto) y el operador elige.
  const [certFotoUrl, setCertFotoUrl] = useState<string | null>(null)
  const [certError, setCertError] = useState('')
  // Video del servicio: subida directa a R2 (prefirmada) + adjuntar al correo.
  const videoInputRef = useRef<HTMLInputElement>(null)
  const [subiendoVideo, setSubiendoVideo] = useState(false)
  const [videoError, setVideoError] = useState('')
  // Foto de evidencia del peso (se sube cuando hay diferencia de tramo).
  const fotoEvidenciaInputRef = useRef<HTMLInputElement>(null)
  const [subiendoFoto, setSubiendoFoto] = useState(false)
  const [fotoError, setFotoError] = useState('')
  // Correo de cobro por la diferencia de peso (con la foto de respaldo adjunta).
  const [enviandoCobro, setEnviandoCobro] = useState(false)
  const [cobroError, setCobroError] = useState('')
  // Confirmar pago de un cobro pendiente (adicional / diferencia) desde el banner.
  const [pagandoCobroId, setPagandoCobroId] = useState('')
  // Pago parcial: monto abonado por el tutor (el resto queda como saldo pendiente).
  const [abono, setAbono] = useState('')
  // Toast centrado "Cambios guardados correctamente" (se auto-oculta a los 3s).
  const [toastOk, setToastOk] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Menú "Documentos" (certificados + archivos).
  const [docsOpen, setDocsOpen] = useState(false)
  const docsMenuRef = useRef<HTMLDivElement>(null)
  // Viñeta de confirmación para adjuntar el video del servicio al correo del certificado.
  const [confirmVideoOpen, setConfirmVideoOpen] = useState(false)
  const certInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<Partial<ClienteDetalle>>({})
  const [veterinarias, setVeterinarias] = useState<Veterinario[]>([])
  const [esVeterinaria, setEsVeterinaria] = useState(false)
  const [tramosEspeciales, setTramosEspeciales] = useState<TramoEspecial[]>([])
  const [preciosGenerales, setPreciosGenerales] = useState<Tramo[]>([])
  const [preciosConvenio, setPreciosConvenio] = useState<Tramo[]>([])
  const [especies, setEspecies] = useState<Especie[]>([])

  // Adicionales
  const [showAdicionales, setShowAdicionales] = useState(false)
  const [adicionales, setAdicionales] = useState<AdicionalItem[]>([])
  const [productosDisp, setProductosDisp] = useState<Producto[]>([])
  // Categorías de productos expandidas en "Adicionales" (cerradas por defecto:
  // colapsadas muestran solo lo ya seleccionado).
  const [catsAbiertas, setCatsAbiertas] = useState<Set<string>>(new Set())
  const toggleCat = (cat: string) => setCatsAbiertas(s => {
    const n = new Set(s)
    if (n.has(cat)) n.delete(cat); else n.add(cat)
    return n
  })
  const [otrosServicios, setOtrosServicios] = useState<OtroServicio[]>([])

  // Descuento
  const [descuentosDisp, setDescuentosDisp] = useState<Descuento[]>([])
  const [aplicarDescuento, setAplicarDescuento] = useState(false)
  const [descuentoId, setDescuentoId] = useState('')

  // Certificados emitidos (para botones de descarga y envío por correo)
  const [certificadosEmitidos, setCertificadosEmitidos] = useState<Certificado[]>([])
  const [enviandoCert, setEnviandoCert] = useState(false)
  const [feedbackCert, setFeedbackCert] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)

  // Correos transaccionales enviados al tutor (estado de entrega por etapa).
  const [correos, setCorreos] = useState<CorreoCliente[]>([])

  // Eliminar ficha (admin only)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deletingFicha, setDeletingFicha] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const fetchCertificados = useCallback(async () => {
    const res = await fetch(`/api/clientes/${id}/certificados`).catch(() => null)
    if (!res || !res.ok) return
    const data = await res.json().catch(() => [])
    setCertificadosEmitidos(Array.isArray(data) ? data : [])
  }, [id])

  const fetchCorreos = useCallback(async () => {
    const res = await fetch(`/api/clientes/${id}/correos`).catch(() => null)
    if (!res || !res.ok) return
    const data = await res.json().catch(() => ({}))
    setCorreos(Array.isArray(data?.correos) ? data.correos : [])
  }, [id])

  // Recarga solo la ficha del cliente (usado tras subir/eliminar un video).
  const recargarCliente = useCallback(async () => {
    const d = await fetch(`/api/clientes/${id}`).then(r => r.json()).catch(() => null)
    if (!d || d.error) return
    setCliente({
      ...d,
      fecha_retiro: formatDateForSheet(d.fecha_retiro) || d.fecha_retiro || '',
      fecha_defuncion: formatDateForSheet(d.fecha_defuncion) || d.fecha_defuncion || '',
      fecha_creacion: formatDateForSheet(d.fecha_creacion) || d.fecha_creacion || '',
    })
  }, [id])

  useEffect(() => {
    fetch(`/api/clientes/${id}`)
      .then(r => r.json())
      .then(d => {
        // Normalizar fechas: el sheet las devuelve como serial Excel (ej. "46141"),
        // pero los <input type="date"> requieren formato "YYYY-MM-DD" para mostrarlas.
        const normalized = {
          ...d,
          fecha_retiro: formatDateForSheet(d.fecha_retiro) || d.fecha_retiro || '',
          fecha_defuncion: formatDateForSheet(d.fecha_defuncion) || d.fecha_defuncion || '',
          fecha_creacion: formatDateForSheet(d.fecha_creacion) || d.fecha_creacion || '',
        }
        setCliente(normalized)
        setForm(normalized)
        if (d.veterinaria_id) setEsVeterinaria(true)
        if (d.adicionales) {
          try { setAdicionales(JSON.parse(d.adicionales)) } catch {}
        }
        if (d.descuento_id) {
          setAplicarDescuento(true)
          setDescuentoId(String(d.descuento_id))
        }
        setLoading(false)
      })
    fetch('/api/veterinarios?activo=true')
      .then(r => r.json())
      .then(d => setVeterinarias(Array.isArray(d) ? d : []))
    fetch('/api/productos')
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d)) return setProductosDisp([])
        // Deduplicar por id: si hay duplicados en la planilla, el toggle se "contagia"
        // a los hermanos y los activa/desactiva todos juntos. Nos quedamos con el primero.
        const vistos = new Set<string>()
        const unicos = d.filter((p: Producto) => p.activo === 'TRUE' && !vistos.has(p.id) && (vistos.add(p.id), true))
        setProductosDisp(unicos)
      })
    fetch('/api/servicios?tipo=otros')
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d)) return setOtrosServicios([])
        const vistos = new Set<string>()
        const unicos = d.filter((s: OtroServicio) => s.activo === 'TRUE' && !vistos.has(s.id) && (vistos.add(s.id), true))
        setOtrosServicios(unicos)
      })
    fetch('/api/precios?tipo=general')
      .then(r => r.json())
      .then(d => setPreciosGenerales(Array.isArray(d) ? d : []))
    fetch('/api/precios?tipo=convenio')
      .then(r => r.json())
      .then(d => setPreciosConvenio(Array.isArray(d) ? d : []))
    fetch('/api/especies')
      .then(r => r.json())
      .then(d => setEspecies(Array.isArray(d) ? d.filter((e: Especie) => e.activo === 'TRUE') : []))
    fetch('/api/descuentos')
      .then(r => r.json())
      .then(d => setDescuentosDisp(Array.isArray(d) ? d.filter((x: Descuento) => x.activo === 'TRUE') : []))
    fetchCertificados()
    fetchCorreos()
  }, [id, fetchCertificados, fetchCorreos])

  // Cerrar el menú "Documentos" al hacer click fuera.
  useEffect(() => {
    if (!docsOpen) return
    function onDoc(e: MouseEvent) {
      if (docsMenuRef.current && !docsMenuRef.current.contains(e.target as Node)) setDocsOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [docsOpen])

  // Load special pricing when vet changes
  useEffect(() => {
    const vetId = form.veterinaria_id
    if (!vetId) { setTramosEspeciales([]); return }
    const vet = veterinarias.find(v => v.id === vetId)
    if (vet?.tipo_precios === 'precios_especiales') {
      fetch(`/api/precios/especiales?veterinaria_id=${vetId}`)
        .then(r => r.json())
        .then(d => setTramosEspeciales(Array.isArray(d) ? d : []))
    } else {
      setTramosEspeciales([])
    }
  }, [form.veterinaria_id, veterinarias])

  // Auto-set tipo_precios when vet is selected
  useEffect(() => {
    if (!form.veterinaria_id) {
      setForm(f => ({ ...f, tipo_precios: 'general' }))
      return
    }
    const vet = veterinarias.find(v => v.id === form.veterinaria_id)
    if (vet) {
      setForm(f => ({ ...f, tipo_precios: vet.tipo_precios === 'precios_especiales' ? 'especial' : 'convenio' }))
    }
  }, [form.veterinaria_id, veterinarias])

  function abrirModalCertificado() {
    setCertFoto(null)
    setCertFotoUrl(null)
    setCertError('')
    setShowCertModal(true)
  }

  async function generarCertificado(e: React.FormEvent) {
    e.preventDefault()
    setCertError('')
    setDescargandoCert(true)
    try {
      // Por defecto SIN foto; solo lleva foto si el operador eligió una (subida
      // por el tutor) o subió una nueva.
      const sinFoto = !certFoto && !certFotoUrl
      const fd = new FormData()
      fd.append('sin_foto', sinFoto ? 'true' : 'false')
      if (certFoto) fd.append('foto', certFoto)
      else if (certFotoUrl) fd.append('foto_url', certFotoUrl)

      const res = await fetch(`/api/clientes/${id}/certificado`, { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setCertError(err.error ?? 'Error generando el certificado')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Certificado_${cliente?.nombre_mascota ?? id}_${cliente?.codigo ?? id}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setShowCertModal(false)
      // El backend acaba de registrar una nueva versión en R2 — refrescamos la lista
      // para que aparezcan los botones de descargar / enviar por correo.
      await fetchCertificados()
    } finally {
      setDescargandoCert(false)
    }
  }

  async function enviarCertificadoCorreo(adjuntarVideo: boolean) {
    setFeedbackCert(null)
    setEnviandoCert(true)
    try {
      const res = await fetch(`/api/clientes/${id}/certificado/enviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjuntar_video: adjuntarVideo }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFeedbackCert({ kind: 'error', msg: data?.error ?? 'No se pudo enviar el correo' })
        return
      }
      setFeedbackCert({ kind: 'ok', msg: `Certificado enviado a ${data.to}` })
      // Refrescar la lista para que aparezca el banner "Enviado el ..."
      await fetchCertificados()
    } catch (e) {
      setFeedbackCert({ kind: 'error', msg: e instanceof Error ? e.message : 'Error al enviar' })
    } finally {
      setEnviandoCert(false)
    }
  }

  async function subirVideo(file: File) {
    setVideoError('')
    setSubiendoVideo(true)
    try {
      // 1) URL prefirmada
      const pres = await fetch(`/api/clientes/${id}/video/presign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: file.type, filename: file.name }),
      })
      const pd = await pres.json().catch(() => ({}))
      if (!pres.ok) { setVideoError(pd.error || 'No se pudo preparar la subida'); return }
      // 2) PUT directo a R2
      const put = await fetch(pd.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!put.ok) { setVideoError('Falló la subida del video a R2. Verifica la configuración CORS del bucket.'); return }
      // 3) Registrar la URL en la ficha
      const reg = await fetch(`/api/clientes/${id}/video`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pd.publicUrl }),
      })
      if (!reg.ok) { const rd = await reg.json().catch(() => ({})); setVideoError(rd.error || 'No se pudo registrar el video'); return }
      await recargarCliente()
    } catch {
      setVideoError('Error subiendo el video. Inténtalo de nuevo.')
    } finally {
      setSubiendoVideo(false)
    }
  }

  async function eliminarVideo(url: string) {
    if (!confirm('¿Eliminar este video del servicio?')) return
    await fetch(`/api/clientes/${id}/video?url=${encodeURIComponent(url)}`, { method: 'DELETE' }).catch(() => {})
    await recargarCliente()
  }

  async function subirFotoEvidencia(file: File) {
    setFotoError('')
    setSubiendoFoto(true)
    try {
      // 1) URL prefirmada (soporta fotos grandes de celular sin el límite de Vercel)
      const pres = await fetch(`/api/clientes/${id}/foto-evidencia/presign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: file.type }),
      })
      const pd = await pres.json().catch(() => ({}))
      if (!pres.ok) { setFotoError(pd.error || 'No se pudo preparar la subida'); return }
      // 2) PUT directo a R2
      const put = await fetch(pd.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!put.ok) { setFotoError('Falló la subida de la foto a R2. Verifica la configuración CORS del bucket.'); return }
      // 3) Registrar la URL en la ficha
      const reg = await fetch(`/api/clientes/${id}/foto-evidencia`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pd.publicUrl }),
      })
      if (!reg.ok) { const rd = await reg.json().catch(() => ({})); setFotoError(rd.error || 'No se pudo registrar la foto'); return }
      await recargarCliente()
    } catch {
      setFotoError('Error subiendo la foto. Inténtalo de nuevo.')
    } finally {
      setSubiendoFoto(false)
    }
  }

  async function eliminarFotoEvidencia(url: string) {
    if (!confirm('¿Eliminar esta foto de evidencia?')) return
    await fetch(`/api/clientes/${id}/foto-evidencia?url=${encodeURIComponent(url)}`, { method: 'DELETE' }).catch(() => {})
    await recargarCliente()
  }

  async function enviarCobroDiferencia() {
    if (!confirm('¿Enviar al tutor el correo (y WhatsApp) solicitando el pago de la diferencia de peso, con la foto de respaldo adjunta?')) return
    setCobroError('')
    setEnviandoCobro(true)
    try {
      const r = await fetch(`/api/clientes/${id}/cobro-diferencia`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setCobroError(d.error || 'No se pudo enviar el cobro.'); return }
      await recargarCliente()
    } catch {
      setCobroError('Error de red. Intenta de nuevo.')
    } finally {
      setEnviandoCobro(false)
    }
  }

  function intentarEnviarCertificado() {
    // Si la versión actual ya fue enviada al menos una vez, pedimos confirmación
    // explícita antes de reenviar (evita doble-envío accidental).
    const cu = certificadosEmitidos[0]
    const yaEnviado = !!(cu?.enviado_ultima_fecha)
    if (yaEnviado) {
      const fecha = cu.enviado_ultima_fecha ? fmtFecha(cu.enviado_ultima_fecha) : '—'
      const hora = cu.enviado_ultima_hora ? ` a las ${cu.enviado_ultima_hora}` : ''
      const dest = cu.enviado_a ? ` a ${cu.enviado_a}` : ''
      const cantidad = parseInt(cu.enviado_cantidad || '0', 10) || 0
      const veces = cantidad > 1 ? ` (ya se reenvió ${cantidad - 1} ${cantidad - 1 === 1 ? 'vez' : 'veces'})` : ''
      const ok = confirm(
        `Este certificado (V${cu.version}) ya fue enviado${dest} el ${fecha}${hora}${veces}.\n\n` +
        `¿Quieres reenviarlo de todas formas?`
      )
      if (!ok) return
    }
    // Si hay video del servicio, preguntamos si adjuntarlo (viñeta). Si no hay, envía directo.
    if (videosServicio.length > 0) {
      setConfirmVideoOpen(true)
      return
    }
    enviarCertificadoCorreo(false)
  }

  async function eliminarFicha() {
    if (!cliente) return
    setDeleteError('')
    setDeletingFicha(true)
    try {
      const res = await fetch(`/api/clientes/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDeleteError(data?.error ?? 'No se pudo eliminar la ficha')
        return
      }
      router.push('/clientes')
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setDeletingFicha(false)
    }
  }

  // Muestra el toast centrado y lo oculta a los 3s (reinicia el timer si ya estaba).
  function mostrarGuardado() {
    setToastOk(true)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastOk(false), 3000)
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  async function handleSave(opts?: { registrar?: boolean }) {
    const registrar = opts?.registrar === true
    setSaving(true)
    // Calcular snapshot del descuento al momento de guardar.
    // Si no aplica descuento o el descuento ya no existe, limpiamos las columnas.
    const desc = aplicarDescuento && descuentoId ? descuentosDisp.find(d => d.id === descuentoId) : null
    // Descuento SOLO sobre el precio de la cremación, nunca sobre los adicionales.
    const monto = !desc
      ? 0
      : desc.tipo === 'fijo'
        ? Math.min(parseFloat(desc.valor) || 0, precioServicio)
        : Math.round((precioServicio * (parseFloat(desc.valor) || 0)) / 100)
    const payload = {
      ...form,
      veterinaria_id: esVeterinaria ? (form.veterinaria_id ?? '') : '',
      tipo_precios: esVeterinaria ? form.tipo_precios : 'general',
      adicionales: JSON.stringify(adicionales),
      descuento_id: desc ? desc.id : '',
      descuento_nombre: desc ? desc.nombre : '',
      descuento_tipo: desc ? desc.tipo : '',
      descuento_valor: desc ? String(parseFloat(desc.valor) || 0) : '',
      descuento_monto: desc ? String(monto) : '',
      ...(registrar ? { registrar: true } : {}),
      // Pago parcial: el monto abonado se manda para calcular el saldo pendiente
      // (no se persiste en la ficha; el pendiente vive como cobro 'saldo').
      ...(form.estado_pago === 'parcial' ? { monto_abonado: abono } : {}),
    }
    const res = await fetch(`/api/clientes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const updated = await res.json()
      const norm = {
        ...updated,
        fecha_retiro: formatDateForSheet(updated.fecha_retiro) || updated.fecha_retiro || '',
        fecha_defuncion: formatDateForSheet(updated.fecha_defuncion) || updated.fecha_defuncion || '',
        fecha_creacion: formatDateForSheet(updated.fecha_creacion) || updated.fecha_creacion || '',
      }
      setCliente(norm)
      // Sincronizar TAMBIÉN el form con lo persistido: si queda desactualizado
      // (p. ej. sin el código recién generado), el próximo Guardar mandaría esos
      // valores viejos (así se duplicaba el correo de bienvenida).
      setForm(norm)
      if (registrar) alert(`Ficha registrada. Código generado: ${updated.codigo}. Le enviamos el correo al tutor.`)
      else mostrarGuardado()
    } else {
      const e = await res.json().catch(() => ({}))
      alert(e?.error || 'No se pudo guardar la ficha.')
    }
    setSaving(false)
  }

  // Cargo AUTOMÁTICO de otros servicios (fuera de horario / distancia) al completar
  // un BORRADOR: según fecha/hora/comuna del retiro se pre-cargan solos, siempre
  // deseleccionables. Solo aplica a fichas en estado 'borrador' (una ficha ya
  // registrada no cambia sola sus adicionales al editarla).
  const autoAgregadosRef = useRef<Set<string>>(new Set())
  const autoQuitadosRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (cliente?.estado !== 'borrador') return
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
  }, [cliente?.estado, form.fecha_retiro, form.hora_retiro, form.comuna, otrosServicios])

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

  async function confirmarPago(cobroId: string) {
    if (!confirm('¿Confirmar que recibimos este pago? Se cerrará la cobranza.')) return
    setPagandoCobroId(cobroId)
    try {
      const r = await fetch(`/api/cobros/${cobroId}`, { method: 'PATCH' })
      if (r.ok) await recargarCliente()
      else alert('No se pudo confirmar el pago.')
    } finally {
      setPagandoCobroId('')
    }
  }

  // Prefill del abono al cargar una ficha en pago parcial: abono = total − saldo pendiente.
  useEffect(() => {
    if (!cliente) return
    if (String(cliente.estado_pago || '').toLowerCase() === 'parcial') {
      const saldo = (cliente.cobros || []).find(c => c.tipo === 'saldo' && c.estado !== 'pagado')
      const total = parseInt(String(cliente.precio_total || '0'), 10) || 0
      const m = saldo ? total - (parseInt(saldo.monto, 10) || 0) : 0
      setAbono(m > 0 ? String(m) : '')
    }
  }, [cliente?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="p-8 text-gray-400 text-sm">Cargando...</div>
  if (!cliente) return <div className="p-8 text-gray-400 text-sm">Cliente no encontrado</div>

  const litrosUsados = cliente.ciclo
    ? Math.abs(parseFloat(cliente.ciclo.litros_fin) - parseFloat(cliente.ciclo.litros_inicio))
    : null

  const vetSeleccionada = veterinarias.find(v => v.id === cliente.veterinaria_id)
  // Cremación Premium (CP) incluye sin costo cualquier ánfora premium: su línea
  // suma $0 (igual descuenta stock). Se resuelve por la categoría del producto.
  const adicionalIncluido = (a: AdicionalItem) =>
    a.tipo === 'producto' &&
    anforaPremiumIncluida(form.codigo_servicio, productosDisp.find(p => p.id === a.id)?.categoria)
  const totalAdicionales = adicionales.reduce((sum, a) => sum + (adicionalIncluido(a) ? 0 : a.precio * a.qty), 0)

  // Resolver tabla de precios según tipo_precios del formulario
  const tablaPrecios: Tramo[] = form.tipo_precios === 'especial'
    ? tramosEspeciales
    : form.tipo_precios === 'convenio'
      ? preciosConvenio
      : preciosGenerales
  const tablaNombre = form.tipo_precios === 'especial'
    ? 'Precios especiales'
    : form.tipo_precios === 'convenio'
      ? 'Precios convenio'
      : 'Precios generales'

  // Encontrar tramo para el peso dado — regla de borde canónica (helper compartido).
  const encontrarTramo = (tabla: Tramo[], pesoKg: number): Tramo | null => findTramo(tabla, pesoKg)

  // Preferir peso_ingreso (real) sobre peso_declarado para el cálculo del servicio.
  // parsePeso (no parseFloat) para coincidir con el snapshot del backend en pesos
  // con coma decimal o escalados heredados de Sheets.
  const pesoIngreso = parsePeso(form.peso_ingreso)
  const pesoDeclarado = parsePeso(form.peso_declarado)
  const pesoKg = pesoIngreso > 0 ? pesoIngreso : pesoDeclarado
  const tramoAplicable = encontrarTramo(tablaPrecios, pesoKg)
  const codigoServ = form.codigo_servicio ?? 'CI'
  const precioServicio = precioDelTramo(tramoAplicable, codigoServ)
  const subtotalServicio = precioServicio + totalAdicionales

  // Descuento (aplica sobre subtotal = servicio + adicionales).
  // Si el usuario seleccionó un descuento pero ya no está en la lista activa
  // (porque lo desactivaron en Configuración), recurrimos al snapshot guardado.
  const descuentoActivo = aplicarDescuento && descuentoId
    ? descuentosDisp.find(d => d.id === descuentoId)
    : null
  const descuentoSnapshot: Descuento | null = aplicarDescuento && descuentoId && !descuentoActivo && cliente?.descuento_id === descuentoId
    ? { id: cliente.descuento_id, nombre: cliente.descuento_nombre || '', tipo: cliente.descuento_tipo || '', valor: cliente.descuento_valor || '0', activo: 'FALSE' }
    : null
  const descuentoElegido = descuentoActivo ?? descuentoSnapshot
  const descuentoValorNum = descuentoElegido ? parseFloat(descuentoElegido.valor) || 0 : 0
  const montoDescuento = !descuentoElegido
    ? 0
    : descuentoElegido.tipo === 'fijo'
      ? Math.min(descuentoValorNum, subtotalServicio)
      : Math.round((subtotalServicio * descuentoValorNum) / 100)
  const totalServicio = Math.max(0, subtotalServicio - montoDescuento)

  // Cuando aplica un precio de convenio o especial, mostramos también el
  // precio normal (tabla de precios generales) para tener a la vista cuánto
  // se cobraría si fuera una venta normal sin veterinaria.
  const tramoNormal = encontrarTramo(preciosGenerales, pesoKg)
  const precioNormal = precioDelTramo(tramoNormal, codigoServ)

  // ¿El peso de ingreso cae en un tramo MÁS CARO que el declarado? Igual criterio
  // que la alerta de PesoIngresoField — habilita subir la foto de evidencia.
  const tramoPesoDeclarado = encontrarTramo(tablaPrecios, pesoDeclarado)
  const tramoPesoIngreso = encontrarTramo(tablaPrecios, pesoIngreso)
  const hayDiferenciaPeso = pesoIngreso > 0 && pesoDeclarado > 0 && !!tramoPesoIngreso && !!tramoPesoDeclarado &&
    precioDelTramo(tramoPesoIngreso, codigoServ) > precioDelTramo(tramoPesoDeclarado, codigoServ)
  const mostrarPrecioNormal = form.tipo_precios !== 'general' && precioNormal > 0

  const rangoTramo = tramoAplicable
    ? (() => {
        const maxPesoMin = Math.max(...tablaPrecios.map(t => parseFloat(t.peso_min) || 0))
        const min = parseFloat(tramoAplicable.peso_min) || 0
        return min === maxPesoMin ? `${min} kg o más` : `${tramoAplicable.peso_min} – ${tramoAplicable.peso_max} kg`
      })()
    : null

  // Price type options based on selected vet
  const precioOptions = (() => {
    if (!esVeterinaria || !form.veterinaria_id) return [{ value: 'general', label: 'Precios generales' }]
    const vet = veterinarias.find(v => v.id === form.veterinaria_id)
    // Un veterinario con precios ESPECIALES cobra SIEMPRE el precio especial: no se
    // puede elegir convenio ni general (la opción queda fijada en "especial").
    if (vet?.tipo_precios === 'precios_especiales') {
      return [{ value: 'especial', label: 'Precios especiales' }]
    }
    return [
      { value: 'general', label: 'Precios generales' },
      { value: 'convenio', label: 'Precios convenio' },
    ]
  })()
  // Si el vet tiene precios especiales, el selector queda bloqueado en "especial".
  const precioBloqueado = precioOptions.length === 1 && precioOptions[0].value === 'especial'

  const certUltimo = certificadosEmitidos[0]
  const puedeGenerarCert = cliente.estado === 'cremado' || cliente.estado === 'despachado'

  // Correos al tutor: último registro por etapa + detección de rebote del email.
  const CORREO_RANK: Record<string, number> = { fallido: 1, enviado: 1, entregado: 2, abierto: 3, clic: 4, rebotado: 5, spam: 6 }
  const correosPorTipo: Record<string, CorreoCliente> = {}
  for (const c of correos) {
    const prev = correosPorTipo[c.tipo]
    if (!prev || (CORREO_RANK[c.estado] ?? 0) >= (CORREO_RANK[prev.estado] ?? 0)) correosPorTipo[c.tipo] = c
  }
  const emailActual = (cliente.email || '').trim().toLowerCase()
  const correoProblema = emailActual
    ? [...correos].reverse().find(c => (c.email || '').trim().toLowerCase() === emailActual && (c.estado === 'rebotado' || c.estado === 'spam' || c.estado === 'fallido')) || null
    : null
  const videosServicio: string[] = (() => {
    try { const x = JSON.parse(cliente.videos_servicio || '[]'); return Array.isArray(x) ? x : [] } catch { return [] }
  })()
  // El tutor pidió el video del proceso desde el correo (deja la marca en `notas`).
  const solicitaVideo = /solicit[oó] el video/i.test(cliente.notas || '')
  const fotosEvidencia: string[] = (() => {
    try { const x = JSON.parse(cliente.fotos_evidencia || '[]'); return Array.isArray(x) ? x : [] } catch { return [] }
  })()
  // Fotos que el tutor subió para el cuadro acuarela (servicio Premium).
  const fotosCuadro: string[] = (() => {
    try { const x = JSON.parse(cliente.fotos_cuadro || '[]'); return Array.isArray(x) ? x : [] } catch { return [] }
  })()
  // Fotos que el tutor subió desde el link del correo para el certificado.
  const fotosMascota: string[] = (() => {
    try { const x = JSON.parse(cliente.fotos_mascota || '[]'); return Array.isArray(x) ? x : [] } catch { return [] }
  })()
  const estadoVariant: 'green' | 'blue' | 'yellow' =
    cliente.estado === 'cremado' ? 'green'
    : cliente.estado === 'despachado' ? 'blue'
    : 'yellow'

  return (
    <div className="max-w-4xl">
      {/* Toast centrado "cambios guardados" (auto-oculta a los 3s). */}
      {toastOk && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-white border-2 border-emerald-300 shadow-xl px-6 py-4 animate-in fade-in zoom-in-95 duration-200">
            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 text-lg">✓</span>
            <p className="text-sm font-semibold text-gray-900">Cambios guardados correctamente</p>
          </div>
        </div>
      )}

      <button onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors mb-3"
        title="Volver">
        <span className="text-base">←</span>
        <span className="font-medium">Volver</span>
      </button>

      {cliente.estado === 'borrador' && (
        <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-bold text-amber-900">🗂 Ficha por ingresar</p>
          <p className="text-xs text-amber-800 mt-0.5">
            Esta ficha la creó el bot al agendar. Completa los datos que falten (especie, peso, fechas, datos de pago)
            y presiona <strong>Registrar ficha</strong> para generar el código y enviarle el correo al tutor.
          </p>
        </div>
      )}

      {/* COBROS PENDIENTES (adicional / diferencia de peso). Rojo si el cliente
          aún no confirma; verde-aviso cuando confirmó su transferencia (a revisar). */}
      {(cliente.cobros || []).length > 0 && (
        <div className="mb-4 space-y-2">
          {(cliente.cobros || []).map(cb => {
            const confirmado = cb.estado === 'cliente_confirmo'
            return (
              <div key={cb.id} className={`rounded-xl border-2 px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${confirmado ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
                <div className="min-w-[220px]">
                  <p className={`text-sm font-bold ${confirmado ? 'text-emerald-900' : 'text-red-900'}`}>
                    {confirmado ? '✅ Cliente confirmó el pago — revisar' : '⚠️ Cobro pendiente'}
                    {' · '}{fmtPrecio(parseInt(cb.monto, 10) || 0)}
                  </p>
                  <p className={`text-xs mt-0.5 ${confirmado ? 'text-emerald-800' : 'text-red-800'}`}>
                    {cb.tipo === 'diferencia' ? 'Diferencia de peso' : cb.tipo === 'saldo' ? 'Saldo pendiente (pago parcial)' : 'Productos adicionales'}
                    {cb.detalle ? ` — ${cb.detalle}` : ''}
                    {confirmado ? '. El cliente marcó que ya transfirió; verifica y confirma.' : '. Enviado al cliente; a la espera de la transferencia.'}
                  </p>
                </div>
                <button
                  onClick={() => confirmarPago(cb.id)}
                  disabled={pagandoCobroId === cb.id}
                  className="shrink-0 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60"
                  style={{ backgroundColor: confirmado ? '#059669' : '#143C64' }}
                >
                  {pagandoCobroId === cb.id ? '⌛…' : '✓ Confirmar pago'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Header limpio sobre fondo claro: borde lateral indigo + tipografía grande.
          El acento navy va sobre la tarjeta redondeada (el borde respeta el border-radius),
          así no hace falta overflow-hidden — que recortaba el menú "Documentos" en desktop. */}
      <div className="rounded-2xl bg-white border-2 border-gray-300 border-l-4 border-l-brand shadow-md mb-6">
        <div className="px-6 py-6 sm:px-8 sm:py-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex-1 min-w-[260px]">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className={`font-mono text-xs font-bold px-2.5 py-1 rounded border ${cliente.codigo ? 'text-brand bg-brand/10 border-brand/30' : 'text-gray-400 bg-gray-100 border-gray-300'}`}>{cliente.codigo || 'sin código'}</span>
                <Badge variant={estadoVariant}>{cliente.estado === 'borrador' ? 'Por ingresar' : cliente.estado && cliente.estado !== 'pendiente' ? cliente.estado : 'retirado'}</Badge>
                {cliente.estado !== 'borrador' && (cliente.estado_pago === 'pagado'
                  ? <Badge variant="green">Pagado</Badge>
                  : cliente.estado_pago === 'parcial'
                  ? <Badge variant="yellow">Pago parcial</Badge>
                  : <Badge variant="yellow">Pago pendiente</Badge>)}
                {vetSeleccionada && <Badge variant="blue">{vetSeleccionada.nombre}</Badge>}
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-brand truncate">{cliente.nombre_mascota}</h1>
              <p className="text-sm text-gray-600 mt-1">Tutor: <span className="font-semibold text-gray-900">{cliente.nombre_tutor || '—'}</span></p>
            </div>
            {cliente.estado !== 'borrador' && (
              <div className="relative w-full sm:w-auto sm:shrink-0" ref={docsMenuRef}>
                {/* Inputs ocultos: compartidos por el menú y el botón de evidencia del peso. */}
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) subirVideo(f); e.target.value = '' }}
                />
                <input
                  ref={fotoEvidenciaInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) subirFotoEvidencia(f); e.target.value = '' }}
                />

                <button
                  onClick={() => setDocsOpen(o => !o)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  📁 Documentos <span className="text-[10px]">▾</span>
                </button>

                {docsOpen && (
                  <>
                  {/* Backdrop solo en móvil (el panel es un bottom-sheet) */}
                  <div className="fixed inset-0 bg-black/30 z-40 sm:hidden" onClick={() => setDocsOpen(false)} aria-hidden="true" />
                  <div className="fixed inset-x-3 bottom-3 z-50 max-h-[80vh] overflow-y-auto rounded-xl border border-gray-300 bg-white shadow-2xl p-1 sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-auto sm:mt-2 sm:w-80 sm:max-w-[88vw] sm:max-h-[70vh] sm:shadow-xl">
                    {/* Cabecera (solo móvil): deja claro que es un panel cerrable */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-300 sm:hidden">
                      <span className="text-sm font-bold text-gray-800">Documentos</span>
                      <button onClick={() => setDocsOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-1">×</button>
                    </div>
                    {/* Certificados */}
                    <p className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">Certificados</p>
                    <button
                      onClick={() => { setDocsOpen(false); abrirModalCertificado() }}
                      disabled={!puedeGenerarCert || descargandoCert}
                      title={!puedeGenerarCert ? 'Disponible cuando la mascota esté cremada' : ''}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-brand/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      📄 <span>{certUltimo ? 'Emitir nueva versión' : 'Emitir certificado'}</span>
                    </button>
                    <button
                      onClick={() => { setDocsOpen(false); intentarEnviarCertificado() }}
                      disabled={enviandoCert || !cliente.email || !certUltimo}
                      title={!certUltimo ? 'Emite primero un certificado' : !cliente.email ? 'El cliente no tiene email' : `Enviar a ${cliente.email}`}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-brand/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {certUltimo?.enviado_ultima_fecha ? '🔄' : '📧'} <span>Reenviar certificado al correo</span>
                    </button>
                    {/* Certificados emitidos: listados acá mismo, bajo los botones */}
                    {certificadosEmitidos.length > 0 && (
                      <div className="px-1 pb-1 space-y-0.5">
                        <p className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-300">Emitidos ({certificadosEmitidos.length})</p>
                        {certificadosEmitidos.map(c => (
                          <a key={`cert-${c.id}`} href={c.pdf_url || undefined} target="_blank" rel="noopener noreferrer"
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-gray-50 ${c.pdf_url ? 'text-gray-700' : 'text-gray-400 pointer-events-none'}`}>
                            📄 <span className="flex-1 truncate">Certificado V{c.version}</span>
                            <span className="text-[11px] text-gray-400 shrink-0">{fmtFecha(c.fecha_emision)}</span>
                            {c.pdf_url && <span className="text-[11px] font-medium text-brand shrink-0">Abrir</span>}
                          </a>
                        ))}
                      </div>
                    )}

                    <div className="my-1 border-t border-gray-300" />

                    {/* Archivos */}
                    <div className="flex items-center justify-between px-3 pt-2 pb-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Archivos</p>
                      <div className="flex gap-2">
                        <button onClick={() => videoInputRef.current?.click()} disabled={subiendoVideo} className="text-[11px] font-medium text-brand hover:underline disabled:opacity-50">{subiendoVideo ? 'Subiendo…' : '+ Video'}</button>
                        <button onClick={() => fotoEvidenciaInputRef.current?.click()} disabled={subiendoFoto} className="text-[11px] font-medium text-brand hover:underline disabled:opacity-50">{subiendoFoto ? 'Subiendo…' : '+ Foto'}</button>
                      </div>
                    </div>
                    <div className="px-1 pb-2 space-y-0.5">
                      {videosServicio.map((url, i) => (
                        <div key={`vid-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-gray-50 text-gray-700">
                          🎬 <a href={url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate hover:underline">Video {i + 1}</a>
                          <button onClick={() => eliminarVideo(url)} className="text-[11px] text-red-600 hover:text-red-800 shrink-0">Eliminar</button>
                        </div>
                      ))}
                      {fotosEvidencia.map((url, i) => (
                        <div key={`foto-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-gray-50 text-gray-700">
                          📷 <a href={url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate hover:underline">Foto evidencia {i + 1}</a>
                          <button onClick={() => eliminarFotoEvidencia(url)} className="text-[11px] text-red-600 hover:text-red-800 shrink-0">Eliminar</button>
                        </div>
                      ))}
                      {/* Fotos que el tutor subió desde el link del correo (certificado) */}
                      {fotosMascota.map((url, i) => (
                        <div key={`fmasc-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-gray-50 text-gray-700">
                          🐾 <a href={url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate hover:underline">Foto del tutor (certificado) {i + 1}</a>
                        </div>
                      ))}
                      {videosServicio.length === 0 && fotosEvidencia.length === 0 && fotosMascota.length === 0 && (
                        <p className="px-2 py-2 text-xs text-gray-400">Aún no hay videos ni fotos guardados.</p>
                      )}
                    </div>
                  </div>
                  </>
                )}

                {solicitaVideo && (
                  <div
                    title="El tutor solicitó el video del proceso desde el correo. Recuerda prepararlo y adjuntarlo."
                    className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800"
                  >
                    🎥 Cliente solicita video
                  </div>
                )}
              </div>
            )}
          </div>
          {feedbackCert && (
            <div className={`mt-4 rounded-lg px-3 py-2 text-xs font-medium border ${
              feedbackCert.kind === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              {feedbackCert.msg}
            </div>
          )}

          {/* Viñeta: ¿adjuntar el video del servicio al correo del certificado? */}
          <Modal open={confirmVideoOpen} onClose={() => setConfirmVideoOpen(false)} title="Adjuntar video al correo">
            <div className="space-y-4">
              <p className="text-sm text-gray-700">
                Esta ficha tiene {videosServicio.length === 1 ? 'un video' : `${videosServicio.length} videos`} del servicio.
                ¿Quieres adjuntar el video en el correo del certificado?
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => { setConfirmVideoOpen(false); enviarCertificadoCorreo(true) }}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2 text-sm font-semibold transition-colors"
                >
                  Sí, adjuntar el video
                </button>
                <button
                  onClick={() => { setConfirmVideoOpen(false); enviarCertificadoCorreo(false) }}
                  className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors"
                >
                  No, enviar sin el video
                </button>
              </div>
            </div>
          </Modal>

          {/* Banner permanente: solo aparece cuando hay un envío real registrado
              en sheet `certificados` (vía POST /api/clientes/[id]/certificado/enviar).
              Estado 'despachado' por sí solo no implica envío. */}
          {certUltimo?.enviado_ultima_fecha && (
            <div className="mt-4 rounded-lg px-3 py-2.5 text-xs font-medium bg-emerald-50 border-2 border-emerald-200 text-emerald-900 flex items-center gap-2">
              <span className="text-base">✓</span>
              <div className="flex-1">
                <span className="font-semibold">El certificado fue enviado al cliente</span>
                {certUltimo.enviado_a ? <span> a <span className="font-mono">{certUltimo.enviado_a}</span></span> : null}
                <span> el {fmtFecha(certUltimo.enviado_ultima_fecha)}</span>
                {certUltimo.enviado_ultima_hora ? <span> a las {certUltimo.enviado_ultima_hora}</span> : null}
                {parseInt(certUltimo.enviado_cantidad || '0', 10) > 1 && (
                  <span className="text-emerald-700"> · reenviado {parseInt(certUltimo.enviado_cantidad || '0', 10) - 1} {parseInt(certUltimo.enviado_cantidad || '0', 10) - 1 === 1 ? 'vez' : 'veces'}</span>
                )}
              </div>
            </div>
          )}

          {videoError && (
            <div className="mt-4 rounded-lg px-3 py-2 text-xs font-medium bg-red-50 border border-red-200 text-red-800">{videoError}</div>
          )}
        </div>
      </div>

      {/* Correos al tutor: estado de entrega por etapa del proceso. */}
      {cliente.estado !== 'borrador' && (
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 mb-6 overflow-hidden">
          <div className="bg-gradient-to-r from-sky-50 to-brand/10 px-6 py-3 border-b-2 border-sky-100 flex items-center gap-2">
            <span className="text-lg">✉️</span>
            <h2 className="text-sm font-bold text-sky-900 uppercase tracking-wide">Correos al tutor</h2>
          </div>
          <div className="p-4 sm:p-6">
            {correoProblema && (
              <div className="mb-3 rounded-lg bg-red-50 border-2 border-red-200 px-3 py-2.5 text-xs text-red-800 flex items-start gap-2">
                <span className="text-base leading-none">⚠</span>
                <span>
                  El correo <b>{cliente.email}</b> {correoProblema.estado === 'rebotado' ? 'rebotó' : correoProblema.estado === 'spam' ? 'fue marcado como spam' : 'falló al enviarse'} — el tutor podría no estar recibiendo los avisos. Revisa que la dirección sea correcta.
                  {correoProblema.motivo ? <span className="block text-[11px] text-red-600 mt-0.5">Motivo: {correoProblema.motivo}</span> : null}
                </span>
              </div>
            )}
            {correos.length === 0 ? (
              <p className="text-sm text-gray-400">Sin registro de correos para esta ficha todavía. Los correos enviados de aquí en adelante quedan registrados con su estado de entrega.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {([
                  { tipo: 'registro', label: 'Registro / bienvenida' },
                  { tipo: 'inicio_cremacion', label: 'Inicio de cremación' },
                  { tipo: 'inicio_despacho', label: 'Vamos en camino (ruta)' },
                  { tipo: 'entrega', label: 'Entrega confirmada' },
                  { tipo: 'certificado', label: 'Certificado de cremación' },
                  { tipo: 'cobro_diferencia', label: 'Cobro diferencia de peso' },
                ] as const).map(et => {
                  const c = correosPorTipo[et.tipo]
                  return (
                    <li key={et.tipo} className="flex items-center gap-3 py-2">
                      <span className="flex-1 text-sm text-gray-700">{et.label}</span>
                      {c && <span className="text-[11px] text-gray-400 shrink-0">{fmtFecha(c.fecha_envio)}</span>}
                      <CorreoEstadoBadge estado={c?.estado} />
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Proceso de cremación — rediseñado con header colorido y mejor jerarquía */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 mb-6 overflow-hidden">
        <div className="bg-gradient-to-r from-rose-50 to-orange-50 px-6 py-3 border-b-2 border-rose-100 flex items-center gap-2">
          <span className="text-lg">🔥</span>
          <h2 className="text-sm font-bold text-rose-900 uppercase tracking-wide">Proceso de cremación</h2>
        </div>
        <div className="p-6">
          {cliente.ciclo ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <InfoField label="Fecha del ciclo" value={fmtFecha(cliente.ciclo.fecha)} />
              <InfoField label="N° ciclo" value={`N° ${cliente.ciclo.numero_ciclo}`} />
              <InfoField label="Litros utilizados" value={litrosUsados !== null ? fmtLitros(litrosUsados) : '—'} />
              <InfoField label="Comentarios" value={cliente.ciclo.comentarios || '—'} />
            </div>
          ) : (
            <div className="flex items-center gap-3 text-yellow-800 bg-yellow-50 border-2 border-yellow-300 rounded-lg px-4 py-3 text-sm font-medium">
              <span>⏳</span>
              <span>Pendiente de cremación — aún no asignada a ningún ciclo.</span>
            </div>
          )}
        </div>
      </div>

      {/* Archivos del cliente: todo lo que subió el tutor (certificado + cuadro) y
          el equipo (videos del servicio, evidencia del peso), en una sola sección. */}
      {(fotosMascota.length > 0 || fotosCuadro.length > 0 || videosServicio.length > 0 || fotosEvidencia.length > 0) && (
        <div className="bg-white rounded-xl shadow-md border-2 border-amber-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🗂️</span>
            <h2 className="text-base font-bold text-gray-900">Archivos</h2>
          </div>
          <div className="space-y-4">
            {fotosMascota.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">📷 Fotos del tutor para el certificado</p>
                <div className="flex flex-wrap gap-3">
                  {fotosMascota.map((url, i) => (
                    <a key={url + i} href={url} target="_blank" rel="noopener noreferrer"
                      className="block w-24 h-24 rounded-lg overflow-hidden border-2 border-gray-300 hover:border-brand transition-colors">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Foto certificado ${i + 1}`} className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {fotosCuadro.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">
                  🖼️ Foto para el cuadro conmemorativo
                  <span className="ml-2 text-[11px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">Premium</span>
                </p>
                <div className="flex flex-wrap gap-3">
                  {fotosCuadro.map((url, i) => (
                    <a key={url + i} href={url} target="_blank" rel="noopener noreferrer"
                      className="block w-24 h-24 rounded-lg overflow-hidden border-2 border-amber-300 hover:border-amber-500 transition-colors">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Foto cuadro ${i + 1}`} className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {fotosEvidencia.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">⚖️ Evidencia del peso real</p>
                <div className="flex flex-wrap gap-3">
                  {fotosEvidencia.map((url, i) => (
                    <a key={url + i} href={url} target="_blank" rel="noopener noreferrer"
                      className="block w-24 h-24 rounded-lg overflow-hidden border-2 border-amber-300 hover:border-amber-500 transition-colors">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Evidencia peso ${i + 1}`} className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {videosServicio.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">🎬 Videos del servicio</p>
                <div className="space-y-1">
                  {videosServicio.map((url, i) => (
                    <a key={url + i} href={url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-brand-soft hover:underline mr-4">
                      🎬 Video {i + 1}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Despacho — solo si fue despachada */}
      {cliente.estado === 'despachado' && (
        <div className="bg-white rounded-xl shadow-md border-2 border-emerald-200 p-6 mb-6">
          <h2 className="text-base font-bold text-gray-900 mb-4">Despacho</h2>
          {cliente.despacho ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoField label="Fecha del despacho" value={fmtFecha(cliente.despacho.fecha)} />
              <InfoField label="N° de recorrido" value={cliente.despacho.numero_recorrido ? `N° ${cliente.despacho.numero_recorrido}` : '—'} />
              <InfoField label="N° global" value={cliente.despacho.numero_global ? `N° ${cliente.despacho.numero_global}` : '—'} />
              <InfoField label="Nota" value={cliente.despacho.nota || '—'} />
            </div>
          ) : (cliente.codigo_servicio || '').toUpperCase() === 'SD' ? (
            <p className="text-sm text-gray-600">Servicio <strong>Sin Devolución</strong>: el proceso finaliza en la cremación (no se devuelven las cenizas), por lo que no requiere despacho.</p>
          ) : (
            <p className="text-sm text-gray-500">Despacho no encontrado (id: {cliente.despacho_id || '—'}).</p>
          )}
        </div>
      )}

      {/* Eutanasia a domicilio asociada (solo lectura) */}
      {cliente.eutanasia && (
        <div className="bg-white rounded-xl shadow-md border-2 border-amber-300 p-6 mb-6">
          <h2 className="text-base font-bold text-gray-900 mb-1">🩺 Eutanasia a domicilio</h2>
          <p className="text-xs text-gray-500 mb-4">Esta ficha viene de una eutanasia a domicilio. El valor de la eutanasia se cobra aparte y <strong>NO se incluye en la boleta</strong> (la boleta es solo por la cremación).</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <InfoField label="Hora Vet (visita)" value={cliente.eutanasia.hora_servicio || '—'} />
            <InfoField label="Hora Retiro (crematorio)" value={cliente.eutanasia.hora_retiro_crematorio || 'Por confirmar'} />
            <InfoField label="Valor eutanasia (a cobrar, fuera de boleta)" value={cliente.eutanasia.valor_cliente > 0 ? fmtPrecio(cliente.eutanasia.valor_cliente) : '—'} />
          </div>
        </div>
      )}

      {/* Datos de ingreso */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 p-6 mb-6">
        <h2 className="text-base font-bold text-gray-900 mb-4">Datos de ingreso</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field required label="Nombre mascota" value={form.nombre_mascota} onChange={v => setForm(f => ({ ...f, nombre_mascota: v }))} />
          <Field required label="Nombre tutor" value={form.nombre_tutor} onChange={v => setForm(f => ({ ...f, nombre_tutor: v }))} />
          <div>
            <Field required type="email" label="Email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} />
            {correoProblema && (
              <p className="mt-1 text-[11px] font-medium text-red-700">
                ⚠ Este correo {correoProblema.estado === 'rebotado' ? 'rebotó' : correoProblema.estado === 'spam' ? 'fue marcado como spam' : 'falló'} — el tutor podría no recibir los avisos.
              </p>
            )}
          </div>
          <Field required type="tel" label="Teléfono" value={form.telefono} onChange={v => setForm(f => ({ ...f, telefono: v.replace(/\D/g, '').slice(0, 9) }))} placeholder="9 dígitos" />
          <AddressField required label="Dirección de retiro" value={form.direccion_retiro} onChange={v => setForm(f => ({ ...f, direccion_retiro: v }))} />
          <AddressField required label="Dirección de despacho" value={form.direccion_despacho} onChange={v => setForm(f => ({ ...f, direccion_despacho: v }))} />
          <Field required label="Comuna" value={form.comuna} onChange={v => setForm(f => ({ ...f, comuna: v }))} />
          <Field required label="Fecha de retiro" type="date" value={form.fecha_retiro} onChange={v => setForm(f => ({ ...f, fecha_retiro: v }))} />
          <Field label="Hora de retiro" type="time" value={form.hora_retiro} onChange={v => setForm(f => ({ ...f, hora_retiro: v }))} />
          <Field label="Fecha de defunción" type="date" value={form.fecha_defuncion} onChange={v => setForm(f => ({ ...f, fecha_defuncion: v }))} />
          <div>
            <label className="text-xs font-semibold text-gray-700">Especie <span className="text-red-500">*</span></label>
            {/* Dropdown desde la tabla de especies: al elegir setea también letra_especie
                (necesaria para generar el código). Antes era texto libre y, si no coincidía
                con una especie conocida, el registro fallaba con "Falta la especie". */}
            <select
              required
              value={especies.some(es => es.nombre === form.especie) ? (form.especie ?? '') : ''}
              onChange={e => {
                const esp = especies.find(es => es.nombre === e.target.value)
                setForm(f => ({ ...f, especie: e.target.value, letra_especie: esp?.letra ?? '' }))
              }}
              className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${
                especies.some(es => es.nombre === form.especie) ? 'border-gray-300' : 'border-red-300 bg-red-50'
              }`}
            >
              <option value="">Selecciona una especie…</option>
              {especies.map(e => <option key={e.id} value={e.nombre}>{e.nombre}</option>)}
            </select>
          </div>
          <Field required label="Peso declarado (kg)" type="number" step="0.1" value={form.peso_declarado} onChange={v => setForm(f => ({ ...f, peso_declarado: v }))} />
          <PesoIngresoField
            value={form.peso_ingreso ?? ''}
            onChange={v => setForm(f => ({ ...f, peso_ingreso: v }))}
            pesoDeclarado={parseFloat(form.peso_declarado || '0') || 0}
            tabla={tablaPrecios}
            codigoServ={form.codigo_servicio ?? 'CI'}
          />

          {/* Evidencia del peso: aparece cuando el peso de ingreso cae en un tramo
              más caro (o si ya hay fotos cargadas). La foto se guarda junto a los
              demás archivos del cliente y se ve en Documentos → Archivos. */}
          {(hayDiferenciaPeso || fotosEvidencia.length > 0) && (
            <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-semibold text-amber-900">
                  📷 Evidencia del peso real{fotosEvidencia.length > 0 ? ` (${fotosEvidencia.length})` : ''}
                </p>
                <button
                  type="button"
                  onClick={() => fotoEvidenciaInputRef.current?.click()}
                  disabled={subiendoFoto}
                  className="inline-flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50"
                >
                  {subiendoFoto ? '⌛ Subiendo…' : '📷 Subir foto'}
                </button>
              </div>
              <p className="text-[11px] text-amber-800 mt-1">
                Sube una foto que muestre el peso real de la mascota como respaldo del cobro adicional.
              </p>
              {fotoError && <p className="text-[11px] text-red-600 mt-1">{fotoError}</p>}
              {fotosEvidencia.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {fotosEvidencia.map((url, i) => (
                    <div key={url + i} className="relative">
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Evidencia ${i + 1}`} className="w-16 h-16 rounded-md object-cover border border-amber-300" />
                      </a>
                      <button
                        type="button"
                        onClick={() => eliminarFotoEvidencia(url)}
                        title="Eliminar"
                        className="absolute -top-1.5 -right-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full w-4 h-4 grid place-items-center text-[10px] leading-none"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              {/* Con la foto cargada: solicitar el pago de la diferencia por correo
                  (foto adjunta + datos de transferencia) y WhatsApp. Una sola vez. */}
              {fotosEvidencia.length > 0 && (
                <div className="mt-3 pt-3 border-t border-amber-200">
                  {cliente.correo_diferencia_fecha ? (
                    <p className="text-xs font-semibold text-emerald-700">
                      ✅ Correo enviado el {fmtFecha(cliente.correo_diferencia_fecha.slice(0, 10))}
                      {cliente.correo_diferencia_monto ? ` — diferencia cobrada: ${fmtPrecio(parseInt(cliente.correo_diferencia_monto, 10) || 0)}` : ''}
                    </p>
                  ) : (
                    <>
                      {String(form.peso_ingreso ?? '') !== String(cliente.peso_ingreso ?? '') || String(form.peso_declarado ?? '') !== String(cliente.peso_declarado ?? '') ? (
                        <p className="text-[11px] text-amber-800">💾 Guarda la ficha para poder enviar el cobro (el monto se calcula con los pesos guardados).</p>
                      ) : (
                        <button
                          type="button"
                          onClick={enviarCobroDiferencia}
                          disabled={enviandoCobro}
                          className="inline-flex items-center gap-1.5 bg-brand hover:bg-brand-dark text-white px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-50"
                        >
                          {enviandoCobro ? '⌛ Enviando…' : '✉️ Enviar correo al cliente solicitando pago de la diferencia'}
                        </button>
                      )}
                      {cobroError && <p className="text-[11px] text-red-600 mt-1">{cobroError}</p>}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-gray-700">
              Tipo de servicio <span className="text-red-500">*</span>
            </label>
            <select
              value={form.codigo_servicio}
              required
              onChange={e => setForm(f => ({ ...f, codigo_servicio: e.target.value }))}
              className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${form.codigo_servicio ? 'border-gray-300' : 'border-red-300 bg-red-50'}`}
            >
              {/* Sin esta opción, un valor vacío MOSTRABA "Cremación Individual"
                  sin estar seleccionado (el navegador pinta la primera opción). */}
              {!form.codigo_servicio && <option value="">— Selecciona el servicio —</option>}
              <option value="CI">Cremación Individual (CI)</option>
              <option value="CP">Cremación Premium (CP)</option>
              <option value="SD">Cremación Sin Devolución (SD)</option>
            </select>
          </div>
        </div>

        {/* Veterinaria */}
        <div className="mt-5 pt-5 border-t border-gray-300">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={esVeterinaria}
              onChange={e => {
                setEsVeterinaria(e.target.checked)
                if (!e.target.checked) setForm(f => ({ ...f, veterinaria_id: '', tipo_precios: 'general' }))
              }}
              className="w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand"
            />
            <span className="text-sm font-medium text-gray-700">Cliente Veterinaria</span>
          </label>

          {esVeterinaria && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500">Veterinaria</label>
                <select
                  value={form.veterinaria_id ?? ''}
                  onChange={e => setForm(f => ({ ...f, veterinaria_id: e.target.value }))}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  <option value="">Seleccionar veterinaria...</option>
                  {veterinarias.map(v => (
                    <option key={v.id} value={v.id}>{v.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Tipo de precios</label>
                <select
                  value={form.tipo_precios ?? 'general'}
                  onChange={e => setForm(f => ({ ...f, tipo_precios: e.target.value }))}
                  disabled={precioBloqueado}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-100 disabled:text-gray-500"
                >
                  {precioOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {precioBloqueado ? (
                  <p className="text-xs text-purple-600 mt-1">Este veterinario tiene precios especiales: se aplican siempre.</p>
                ) : tramosEspeciales.length > 0 && (
                  <p className="text-xs text-purple-600 mt-1">{tramosEspeciales.length} tramo(s) especiales cargados</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Pago */}
        <div className="mt-5 pt-5 border-t-2 border-gray-300">
          <p className="text-sm font-bold text-gray-900 mb-3">Pago</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700">
                Tipo de pago <span className="text-red-500">*</span>
              </label>
              <select
                value={form.tipo_pago ?? ''}
                required
                onChange={e => setForm(f => ({ ...f, tipo_pago: e.target.value }))}
                className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${
                  !form.tipo_pago ? 'border-red-300 bg-red-50' : 'border-gray-300'
                }`}
              >
                <option value="">—</option>
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
              <select
                value={form.estado_pago ?? 'pendiente'}
                required
                onChange={e => setForm(f => ({ ...f, estado_pago: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="pendiente">Pendiente de pago</option>
                <option value="parcial">Pago parcial</option>
                <option value="pagado">Pagado</option>
              </select>
            </div>
          </div>

          {/* Pago parcial: box para indicar cuánto abonó → queda un saldo pendiente.
              El total A COBRAR incluye la eutanasia asociada (fuera de boleta). */}
          {form.estado_pago === 'parcial' && (() => {
            const abonoNum = parseInt((abono || '').replace(/\D/g, ''), 10) || 0
            const eutanasiaValor = cliente?.eutanasia?.valor_cliente ?? 0
            const totalACobrar = Math.round(totalServicio) + eutanasiaValor
            const pendiente = Math.max(0, totalACobrar - abonoNum)
            return (
              <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  <div>
                    <label className="text-xs font-semibold text-gray-700">¿Cuánto pagó? (abono)</label>
                    <input
                      type="number" min={0} inputMode="numeric" value={abono}
                      onChange={e => setAbono(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div className="text-sm">
                    <p className="text-xs text-gray-600">Cremación: <span className="font-semibold text-gray-900">{fmtPrecio(Math.round(totalServicio))}</span></p>
                    {eutanasiaValor > 0 && (
                      <>
                        <p className="text-xs text-gray-600">Eutanasia a domicilio <span className="text-gray-400">(fuera de boleta)</span>: <span className="font-semibold text-gray-900">{fmtPrecio(eutanasiaValor)}</span></p>
                        <p className="text-xs text-gray-600">Total a cobrar: <span className="font-semibold text-gray-900">{fmtPrecio(totalACobrar)}</span></p>
                      </>
                    )}
                    <p className="mt-0.5 text-amber-900 font-bold">Pendiente por pagar: {fmtPrecio(pendiente)}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-amber-800">
                  Al guardar queda un <strong>saldo pendiente</strong> por la diferencia (aparece arriba en «pendientes de cobro»). La boleta se emite recién cuando confirmes el pago total.
                </p>
              </div>
            )
          })()}
        </div>

        {/* Notas */}
        <div className="mt-5 pt-5 border-t border-gray-300">
          <label className="text-sm font-semibold text-gray-900">Notas</label>
          <textarea
            value={form.notas ?? ''}
            onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
            rows={3}
            placeholder="Comentarios sobre el servicio, la mascota o el tutor..."
            className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-none"
          />
        </div>

        {/* No pedir evaluación: el correo de entrega va sin el pedido de reseña (clientes conflictivos). */}
        <div className="mt-5 pt-5 border-t border-gray-300">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={String(form.omitir_evaluacion || '').toUpperCase() === 'TRUE'}
              onChange={e => setForm(f => ({ ...f, omitir_evaluacion: e.target.checked ? 'TRUE' : 'FALSE' }))}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand"
            />
            <span>
              <span className="text-sm font-semibold text-gray-900">No pedir evaluación a este cliente</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                Al entregar, se envía el correo de entrega normal pero <strong>sin</strong> el pedido de reseña en Google. Útil para clientes conflictivos.
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-3 mt-5">
          {(cliente.estado === 'borrador' || !cliente.codigo) ? (
            <>
              <button
                onClick={() => handleSave()}
                disabled={saving}
                className="border-2 border-gray-300 text-gray-700 px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar borrador'}
              </button>
              <button
                onClick={() => handleSave({ registrar: true })}
                disabled={saving}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Registrar ficha'}
              </button>
            </>
          ) : (
            <button
              onClick={() => handleSave()}
              disabled={saving}
              className="bg-brand hover:bg-brand-dark text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          )}
        </div>
      </div>

      {/* Adicionales */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 mb-6 overflow-hidden">
        <button
          onClick={() => setShowAdicionales(!showAdicionales)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900">Adicionales</h2>
            {adicionales.length > 0 && (
              <span className="bg-brand/10 text-brand text-xs font-semibold px-2 py-0.5 rounded-full">
                {adicionales.length} ítem(s) · {fmtPrecio(totalAdicionales)}
              </span>
            )}
          </div>
          <span className="text-gray-400 text-sm">{showAdicionales ? '▲' : '▼'}</span>
        </button>

        {showAdicionales && (
          <div className="border-t border-gray-300 px-6 pb-6 pt-4">
            {/* Productos — agrupados por categoría, sin info de stock (oculta);
                los productos con stock = 0 quedan tachados y no seleccionables */}
            {productosDisp.length > 0 && (() => {
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
                <div className="mb-6">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Productos</p>
                  {servicioIncluyeAnforaPremium(form.codigo_servicio) && (
                    <p className="mb-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1.5">
                      Cremación Premium incluye un ánfora premium sin costo: al elegirla queda en $0 y se descuenta del stock igual.
                    </p>
                  )}
                  <div className="space-y-4">
                    {orden.map(cat => {
                      const itemsCat = grupos.get(cat)!
                      const abierta = catsAbiertas.has(cat)
                      const elegidos = itemsCat.filter(pp => adicionales.some(a => a.tipo === 'producto' && a.id === pp.id))
                      // Colapsada: solo los productos ya seleccionados (si hay).
                      const visibles = abierta ? itemsCat : elegidos
                      return (
                      <div key={cat}>
                        <button type="button" onClick={() => toggleCat(cat)}
                          className="w-full flex items-center justify-between gap-2 mb-2 border-b border-brand/20 pb-1 text-left hover:bg-gray-50 rounded transition-colors">
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
                        <div className="space-y-2 pl-1">
                          {visibles.map(p => {
                            const item = adicionales.find(a => a.tipo === 'producto' && a.id === p.id)
                            const stockNum = parseInt(p.stock || '0')
                            const sinStock = stockNum <= 0
                            const incluido = anforaPremiumIncluida(form.codigo_servicio, p.categoria)
                            return (
                              <div key={p.id} className={`flex items-center gap-3 py-1.5 ${sinStock ? 'opacity-50' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={!!item}
                                  disabled={sinStock && !item}
                                  onChange={() => toggleAdicional('producto', p)}
                                  className="w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand disabled:cursor-not-allowed"
                                />
                                <span className={`flex-1 text-sm ${sinStock ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{p.nombre}</span>
                                {incluido ? (
                                  <span className="text-xs font-semibold text-emerald-600">Incluida{p.precio && parseFloat(p.precio) > 0 ? <span className="ml-1 text-gray-400 font-normal line-through">{fmtPrecio(p.precio)}</span> : null}</span>
                                ) : (
                                  <span className={`text-xs ${sinStock ? 'text-gray-400 line-through' : 'text-gray-500'}`}>{fmtPrecio(p.precio)}</span>
                                )}
                                {sinStock && <span className="text-xs text-red-600 font-semibold">sin stock</span>}
                                {item && !sinStock && (
                                  <input
                                    type="number"
                                    min={1}
                                    value={item.qty}
                                    onChange={e => updateQty('producto', p.id, parseInt(e.target.value) || 1)}
                                    className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand"
                                  />
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

            {/* Otros servicios */}
            {otrosServicios.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Otros servicios</p>
                <div className="space-y-2">
                  {otrosServicios.map(s => {
                    const item = adicionales.find(a => a.tipo === 'servicio' && a.id === s.id)
                    return (
                      <div key={s.id} className="flex items-center gap-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={!!item}
                          onChange={() => toggleAdicional('servicio', s)}
                          className="w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand"
                        />
                        <span className="flex-1 text-sm text-gray-900">{s.nombre}</span>
                        <span className="text-xs text-gray-500">{fmtPrecio(s.precio)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {adicionales.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-300 flex justify-between items-center">
                <span className="text-sm text-gray-600">{adicionales.length} ítem(s) seleccionado(s)</span>
                <span className="font-semibold text-gray-900">{fmtPrecio(totalAdicionales)}</span>
              </div>
            )}

            {productosDisp.length === 0 && otrosServicios.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">Sin productos ni servicios adicionales activos</p>
            )}

            <div className="flex justify-end mt-4">
              <button
                onClick={() => handleSave()}
                disabled={saving}
                className="bg-brand text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar adicionales'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Resumen del servicio */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Resumen del servicio</h2>
          <span className="text-xs text-gray-400">{tablaNombre}</span>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-start justify-between py-2 border-b border-gray-300">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">
                Cremación {codigoServ}
                {rangoTramo && <span className="text-gray-500 font-normal"> · {rangoTramo}</span>}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {pesoKg > 0 ? `${pesoKg} kg` : 'Ingresa el peso para calcular'}
                {pesoKg > 0 && !tramoAplicable && (
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
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-2">Adicionales</p>
              {adicionales.map(a => (
                <div key={`${a.tipo}-${a.id}`} className="flex items-center justify-between py-1">
                  <p className="text-sm text-gray-700">
                    {a.nombre}
                    {a.qty > 1 && <span className="text-gray-400"> × {a.qty}</span>}
                  </p>
                  {adicionalIncluido(a)
                    ? <p className="text-sm font-medium text-emerald-600">Incluida</p>
                    : <p className="text-sm text-gray-700">{fmtPrecio(a.precio * a.qty)}</p>}
                </div>
              ))}
              <div className="flex items-center justify-between py-1 border-t border-gray-300 pt-2">
                <p className="text-xs text-gray-500">Subtotal adicionales</p>
                <p className="text-sm font-medium text-gray-700">{fmtPrecio(totalAdicionales)}</p>
              </div>
            </>
          )}

          {/* Descuento */}
          <div className="border-t border-gray-300 pt-3 mt-2">
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
                  {/* Si el cliente quedó con un descuento que ya no está activo, lo mostramos igual para no perderlo silenciosamente */}
                  {cliente?.descuento_id && !descuentosDisp.some(d => d.id === cliente.descuento_id) && (
                    <option value={cliente.descuento_id}>
                      {cliente.descuento_nombre || `Descuento #${cliente.descuento_id}`} (inactivo)
                    </option>
                  )}
                  {descuentosDisp.map(d => {
                    const v = parseFloat(d.valor) || 0
                    const etiquetaValor = d.tipo === 'fijo' ? fmtPrecio(v) : `${v}%`
                    return (
                      <option key={d.id} value={d.id}>
                        {d.nombre} — {etiquetaValor}
                      </option>
                    )
                  })}
                </select>
                {descuentoElegido && montoDescuento > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">
                      {descuentoElegido.nombre}
                      <span className="text-gray-400 ml-1">
                        ({descuentoElegido.tipo === 'fijo' ? 'fijo' : `${descuentoValorNum}%`})
                      </span>
                    </span>
                    <span className="font-semibold text-red-600">− {fmtPrecio(montoDescuento)}</span>
                  </div>
                )}
                {descuentosDisp.length === 0 && !cliente?.descuento_id && (
                  <p className="text-xs text-gray-400">No hay descuentos activos. Ve a Configuración → Descuentos para crear uno.</p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-3 mt-2 border-t-2 border-gray-300">
            <p className="text-base font-bold text-gray-900">Total{(cliente?.eutanasia?.valor_cliente ?? 0) > 0 ? ' cremación (boleta)' : ''}</p>
            <p className="text-lg font-bold text-brand">{fmtPrecio(totalServicio)}</p>
          </div>

          {/* Eutanasia asociada: se cobra JUNTO al retiro pero va fuera de la boleta
              (la boleta es solo por la cremación). Acá se ve el total real a cobrar. */}
          {(cliente?.eutanasia?.valor_cliente ?? 0) > 0 && (
            <>
              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-gray-700">Eutanasia a domicilio <span className="text-xs text-gray-400">(fuera de boleta)</span></p>
                <p className="text-sm font-semibold text-gray-900">{fmtPrecio(cliente!.eutanasia!.valor_cliente)}</p>
              </div>
              <div className="flex items-center justify-between pt-3 mt-2 border-t-2 border-brand/30 bg-cream -mx-2 px-2 py-2 rounded-lg">
                <p className="text-base font-bold text-brand">Total a cobrar al cliente</p>
                <p className="text-xl font-bold text-brand">{fmtPrecio(totalServicio + cliente!.eutanasia!.valor_cliente)}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Zona de peligro: eliminar ficha (solo admin) */}
      {isAdmin && (
        <div className="bg-white rounded-xl border-2 border-red-200 mb-6 overflow-hidden">
          <div className="bg-red-50 px-6 py-3 border-b-2 border-red-100 flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <h2 className="text-sm font-bold text-red-800 uppercase tracking-wide">Zona de peligro</h2>
          </div>
          <div className="p-6 flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">Eliminar ficha del cliente</p>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                Borra esta ficha de la planilla. Devuelve al stock las unidades de productos
                adicionales asociados y quita las referencias de esta mascota en ciclos y despachos.
                Esta acción no se puede deshacer.
              </p>
            </div>
            <button
              onClick={() => { setDeleteConfirmText(''); setDeleteError(''); setShowDeleteModal(true) }}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-md"
            >
              Eliminar ficha
            </button>
          </div>
        </div>
      )}

      {/* Modal confirmación de eliminación — requiere tipear el código para evitar accidentes */}
      <Modal open={showDeleteModal} onClose={() => !deletingFicha && setShowDeleteModal(false)} title="Eliminar ficha">
        <div className="space-y-4">
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-3 text-sm text-red-900">
            <p className="font-semibold">Estás por eliminar permanentemente:</p>
            <p className="mt-1">
              <span className="font-mono text-xs bg-white border border-red-200 px-1.5 py-0.5 rounded">{cliente.codigo || 'Ficha por ingresar'}</span>
              {' · '}
              <span className="font-semibold">{cliente.nombre_mascota}</span>
              {' · '}
              {cliente.nombre_tutor}
            </p>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            Esta acción no se puede deshacer. Para confirmar, escribe {cliente.codigo ? 'el código de la ficha' : ''}
            (<span className="font-mono font-semibold text-gray-900">{cliente.codigo || 'ELIMINAR'}</span>) en el campo de abajo.
          </p>
          <div>
            <label className="text-xs font-semibold text-gray-700">Confirmar código</label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={cliente.codigo || 'ELIMINAR'}
              disabled={deletingFicha}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
              autoFocus
            />
          </div>
          {deleteError && (
            <p className="text-xs text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-2">{deleteError}</p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              disabled={deletingFicha}
              onClick={() => setShowDeleteModal(false)}
              className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={deletingFicha || deleteConfirmText.trim().toUpperCase() !== (cliente.codigo || 'ELIMINAR').toUpperCase()}
              onClick={eliminarFicha}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 text-sm font-semibold shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deletingFicha ? 'Eliminando…' : 'Eliminar definitivamente'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal generar certificado */}
      <Modal open={showCertModal} onClose={() => setShowCertModal(false)} title="Generar certificado de cremación">
        <form onSubmit={generarCertificado} className="space-y-4">
          <div className="text-sm text-gray-600">
            Mascota: <b>{cliente.nombre_mascota}</b> · {cliente.codigo}
          </div>

          {(() => {
            let fotosSubidas: string[] = []
            try { const x = JSON.parse(cliente.fotos_mascota || '[]'); if (Array.isArray(x)) fotosSubidas = x } catch { /* */ }
            return (
              <>
                {/* Fotos que el tutor subió desde el link del correo */}
                {fotosSubidas.length > 0 && (
                  <div>
                    <label className="text-xs font-semibold text-gray-700">
                      Fotos enviadas por el tutor — toca una para usarla
                    </label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {fotosSubidas.map((url, i) => {
                        const sel = certFotoUrl === url
                        return (
                          <button
                            key={url + i}
                            type="button"
                            onClick={() => {
                              if (sel) { setCertFotoUrl(null) }
                              else { setCertFotoUrl(url); setCertFoto(null) }
                            }}
                            className={`relative w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${sel ? 'border-amber-600 ring-2 ring-amber-300' : 'border-gray-300 hover:border-amber-400'}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                            {sel && <span className="absolute top-0.5 right-0.5 bg-amber-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">✓</span>}
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">O sube una nueva foto abajo.</p>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-gray-700">Foto de la mascota (jpg/png)</label>
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      ref={certInputRef}
                      type="file"
                      accept="image/jpeg,image/jpg,image/png"
                      onChange={e => { setCertFoto(e.target.files?.[0] ?? null); setCertFotoUrl(null) }}
                      className="hidden"
                    />
                    <button type="button" onClick={() => certInputRef.current?.click()}
                      className="bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-md transition-colors">
                      📷 Subir foto
                    </button>
                    {certFoto ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-xs text-gray-700 truncate">{certFoto.name}</span>
                        <button type="button" onClick={() => setCertFoto(null)}
                          className="text-xs text-red-600 hover:text-red-800 font-semibold">Quitar</button>
                      </div>
                    ) : certFotoUrl ? (
                      <span className="text-xs text-amber-700 font-medium">Usando una foto enviada por el tutor</span>
                    ) : (
                      <span className="text-xs text-gray-400">Ninguna foto seleccionada</span>
                    )}
                  </div>
                </div>
              </>
            )
          })()}

          <p className="text-[11px] text-gray-500 pt-1 border-t-2 border-gray-300">
            Si no eliges ninguna foto, el certificado se genera <strong>sin foto</strong>.
          </p>

          {certError && (
            <p className="text-xs text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-2">{certError}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowCertModal(false)}
              className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={descargandoCert}
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg py-2 text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
              {descargandoCert ? '⏳ Generando...' : '📄 Generar PDF'}
            </button>
          </div>
        </form>
      </Modal>

    </div>
  )
}

function Field({ label, value, onChange, type = 'text', step, required, placeholder }: {
  label: string; value?: string; onChange: (v: string) => void
  type?: string; step?: string; required?: boolean; placeholder?: string
}) {
  const faltante = required && !String(value ?? '').trim()
  return (
    <div>
      <label className="text-xs font-semibold text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        step={step}
        value={value ?? ''}
        required={required}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${
          faltante ? 'border-red-300 bg-red-50' : 'border-gray-300'
        }`}
      />
    </div>
  )
}

function AddressField({ label, value, onChange, required, placeholder }: {
  label: string; value?: string; onChange: (v: string) => void
  required?: boolean; placeholder?: string
}) {
  const faltante = required && !String(value ?? '').trim()
  return (
    <div>
      <label className="text-xs font-semibold text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="mt-1">
        <AddressAutocomplete
          value={value ?? ''}
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

function PesoIngresoField({ value, onChange, pesoDeclarado, tabla, codigoServ }: {
  value: string
  onChange: (v: string) => void
  pesoDeclarado: number
  tabla: Tramo[]
  codigoServ: string
}) {
  const pesoIngreso = parsePeso(value)

  type Feedback =
    | { kind: 'alerta'; diff: number }
    | { kind: 'igual' }
    | { kind: 'menor'; diff: number }
    | null

  let feedback: Feedback = null
  if (pesoIngreso > 0 && pesoDeclarado > 0 && tabla.length > 0) {
    const tramoDecl = findTramo(tabla, pesoDeclarado)
    const tramoIng = findTramo(tabla, pesoIngreso)
    if (tramoDecl && tramoIng) {
      const pDecl = precioDelTramo(tramoDecl, codigoServ)
      const pIng = precioDelTramo(tramoIng, codigoServ)
      if (tramoIng.id === tramoDecl.id) {
        feedback = { kind: 'igual' }
      } else if (pIng > pDecl) {
        feedback = { kind: 'alerta', diff: pIng - pDecl }
      } else if (pIng < pDecl) {
        feedback = { kind: 'menor', diff: pDecl - pIng }
      }
    }
  }

  const isAlerta = feedback?.kind === 'alerta'

  return (
    <div>
      <label className="text-xs font-medium text-gray-500">Peso ingreso (kg)</label>
      <div className="relative">
        <input
          type="number"
          step="0.1"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
            isAlerta ? 'border-amber-400 bg-amber-50 focus:ring-amber-500' : 'border-gray-300 focus:ring-brand'
          }`}
        />
        {isAlerta && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600 text-lg leading-none pointer-events-none">⚠</span>
        )}
      </div>
      {feedback?.kind === 'alerta' && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="text-amber-600 shrink-0">⚠</span>
          <div>
            <p className="font-medium">Cobro adicional pendiente: el peso real supera el tramo declarado.</p>
            <p className="mt-0.5">Diferencia a cobrar: <span className="font-bold">{fmtPrecio(feedback.diff)}</span></p>
          </div>
        </div>
      )}
      {feedback?.kind === 'igual' && (
        <p className="mt-1 text-xs text-gray-500">✓ Mismo tramo que el peso declarado — no hay cobro adicional.</p>
      )}
      {feedback?.kind === 'menor' && (
        <p className="mt-1 text-xs text-emerald-600">Tramo inferior — ahorro potencial de {fmtPrecio(feedback.diff)}</p>
      )}
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="text-sm text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}

/** Badge de estado de un correo transaccional (o "sin enviar" si no hay registro). */
function CorreoEstadoBadge({ estado }: { estado?: string }) {
  if (!estado) return <span className="text-[11px] text-gray-400 shrink-0">— sin enviar</span>
  const map: Record<string, { cls: string; label: string }> = {
    enviado: { cls: 'bg-blue-100 text-blue-800', label: 'Enviado' },
    entregado: { cls: 'bg-cyan-100 text-cyan-800', label: 'Entregado' },
    abierto: { cls: 'bg-emerald-100 text-emerald-800', label: 'Abierto' },
    clic: { cls: 'bg-violet-100 text-violet-800', label: 'Click' },
    rebotado: { cls: 'bg-red-100 text-red-800', label: 'Rebotó' },
    spam: { cls: 'bg-orange-100 text-orange-800', label: 'Spam' },
    fallido: { cls: 'bg-red-100 text-red-800', label: 'Falló' },
  }
  const s = map[estado] || { cls: 'bg-gray-100 text-gray-700', label: estado }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${s.cls}`}>{s.label}</span>
}
