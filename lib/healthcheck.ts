/**
 * Ping a un monitor tipo Healthchecks.io al final de un cron, en éxito y en fallo —
 * así una corrida que se cae en silencio (excepción no capturada, timeout de la
 * función, etc.) igual se detecta (el monitor avisa por no-show). Cada cron usa su
 * propia env var (`HEALTHCHECK_URL_BACKUP`, `HEALTHCHECK_URL_ARCHIVAR`, ...);
 * OPCIONAL: si no está seteada, esto es un no-op — nunca hace fallar el cron.
 * Convención de Healthchecks.io: GET a la URL = éxito, GET a `<url>/fail` = fallo.
 */
export async function pingHealthcheck(envVar: string, opts: { fail?: boolean } = {}): Promise<void> {
  const url = process.env[envVar]
  if (!url) return
  const target = opts.fail ? `${url.replace(/\/$/, '')}/fail` : url
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    await fetch(target, { method: 'GET', signal: ctrl.signal }).catch(() => { /* el ping nunca debe romper el cron */ })
    clearTimeout(timer)
  } catch { /* idem */ }
}
