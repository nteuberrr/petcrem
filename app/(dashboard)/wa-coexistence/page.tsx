'use client'

import { useEffect, useState, useCallback } from 'react'

/**
 * Herramienta interna (admin) para conectar el número por WhatsApp Coexistence
 * vía Embedded Signup. Lanza el flujo "Conectar tu WhatsApp Business app
 * existente" (featureType 'whatsapp_business_app_onboarding'); Meta genera un QR
 * que se escanea DESDE la WhatsApp Business app para enlazar el número.
 *
 * Requisitos (lado Meta, una sola vez):
 *  - Producto "Facebook Login for Business" agregado a la app.
 *  - Una configuración de Embedded Signup → su id va en NEXT_PUBLIC_FB_COEX_CONFIG_ID.
 *  - El dominio de producción agregado en "Allowed Domains for the JavaScript SDK".
 *  - App ID en NEXT_PUBLIC_FB_APP_ID.
 *
 * Al terminar, el listener captura waba_id + phone_number_id y los manda al
 * backend (/api/whatsapp/coexistence), que suscribe la app a la WABA. Si el
 * phone_number_id cambió, hay que actualizar WHATSAPP_PHONE_NUMBER_ID en Vercel.
 */

const APP_ID = process.env.NEXT_PUBLIC_FB_APP_ID || ''
const CONFIG_ID = process.env.NEXT_PUBLIC_FB_COEX_CONFIG_ID || ''
const GRAPH_VERSION = 'v22.0'

declare global {
  interface Window {
    fbAsyncInit?: () => void
    FB?: { init: (o: Record<string, unknown>) => void; login: (cb: (r: FbLoginResponse) => void, opts: Record<string, unknown>) => void }
  }
}

interface FbLoginResponse {
  authResponse?: { code?: string } | null
  status?: string
}

interface SesionInfo { phone_number_id?: string; waba_id?: string }

export default function WaCoexistencePage() {
  const [sdkListo, setSdkListo] = useState(false)
  const [estado, setEstado] = useState<'idle' | 'lanzando' | 'procesando' | 'ok' | 'error'>('idle')
  const [info, setInfo] = useState<SesionInfo>({})
  const [mensaje, setMensaje] = useState('')
  const [resultado, setResultado] = useState<Record<string, unknown> | null>(null)

  // Carga el SDK de Facebook.
  useEffect(() => {
    if (!APP_ID) return
    window.fbAsyncInit = function () {
      window.FB?.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION })
      setSdkListo(true)
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (document.getElementById('fb-sdk')) { setSdkListo(!!window.FB); return }
    const s = document.createElement('script')
    s.id = 'fb-sdk'
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous'
    s.src = 'https://connect.facebook.net/en_US/sdk.js'
    document.body.appendChild(s)
  }, [])

  // Escucha el mensaje de sesión del Embedded Signup (waba_id + phone_number_id).
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!/facebook\.com$/.test(new URL(ev.origin).hostname)) return
      try {
        const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data
        if (data?.type === 'WA_EMBEDDED_SIGNUP') {
          setInfo({ phone_number_id: data?.data?.phone_number_id, waba_id: data?.data?.waba_id })
        }
      } catch { /* no era JSON nuestro */ }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const conectar = useCallback(() => {
    if (!window.FB || !CONFIG_ID) { setMensaje('Falta configurar NEXT_PUBLIC_FB_COEX_CONFIG_ID / SDK.'); setEstado('error'); return }
    setEstado('lanzando'); setMensaje('')
    window.FB.login(async (resp: FbLoginResponse) => {
      const code = resp?.authResponse?.code
      if (!code) { setEstado('error'); setMensaje('No se completó la conexión (sin code).'); return }
      setEstado('procesando')
      try {
        const r = await fetch('/api/whatsapp/coexistence', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, waba_id: info.waba_id, phone_number_id: info.phone_number_id }),
        })
        const j = await r.json()
        if (!r.ok) { setEstado('error'); setMensaje(j.error || `Error ${r.status}`); return }
        setResultado(j); setEstado('ok')
      } catch (e) {
        setEstado('error'); setMensaje(e instanceof Error ? e.message : 'Error de red')
      }
    }, {
      config_id: CONFIG_ID,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
    })
  }, [info])

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">WhatsApp Coexistence</h1>
        <p className="text-sm text-gray-500">Conecta el número de la WhatsApp Business app al sistema (Cloud API) sin perder la app.</p>
      </div>

      {(!APP_ID || !CONFIG_ID) && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
          Falta configurar en Vercel: {!APP_ID && <code>NEXT_PUBLIC_FB_APP_ID</code>}{(!APP_ID && !CONFIG_ID) && ' y '}{!CONFIG_ID && <code>NEXT_PUBLIC_FB_COEX_CONFIG_ID</code>}. Sin eso el botón no funciona.
        </div>
      )}

      <ol className="text-sm text-gray-700 list-decimal pl-5 space-y-1.5 bg-white border border-gray-200 rounded-lg p-4">
        <li>Asegúrate de tener el número registrado en la <strong>WhatsApp Business app</strong> (no en el Cloud API).</li>
        <li>Presiona <strong>Conectar</strong> abajo y completa el flujo de Meta.</li>
        <li>Te llegará un <strong>QR</strong> / un mensaje de la cuenta oficial de Facebook en tu WhatsApp Business app: <strong>escanéalo</strong> para enlazar.</li>
        <li>Opcional: importa el historial (hasta 6 meses).</li>
      </ol>

      <button type="button" onClick={conectar} disabled={!sdkListo || estado === 'lanzando' || estado === 'procesando'}
        className="bg-[#143C64] hover:bg-[#0f2e4d] text-white rounded-lg px-5 py-2.5 text-sm font-semibold disabled:opacity-50">
        {estado === 'procesando' ? 'Procesando…' : estado === 'lanzando' ? 'Abriendo Meta…' : 'Conectar con WhatsApp Business'}
      </button>

      {(info.waba_id || info.phone_number_id) && (
        <div className="text-xs text-gray-500">WABA: {info.waba_id || '—'} · phone_number_id: {info.phone_number_id || '—'}</div>
      )}
      {estado === 'error' && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{mensaje}</div>}
      {estado === 'ok' && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-3 text-sm space-y-1">
          <p>✅ Conectado. Si el <code>phone_number_id</code> cambió, actualiza <code>WHATSAPP_PHONE_NUMBER_ID</code> en Vercel con el valor de arriba y redeploy.</p>
          {resultado && <pre className="text-[11px] overflow-x-auto">{JSON.stringify(resultado, null, 2)}</pre>}
        </div>
      )}
    </div>
  )
}
