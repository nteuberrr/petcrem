import { problemasGlobal } from './correos-log'

/**
 * Fichas cuyo email VIGENTE tiene problemas de entrega (rebotó / spam / falló en
 * algún correo transaccional).
 *
 * Vive acá y no dentro del route porque lo usan dos puntas: el aviso de la lista
 * (`/api/clientes/correos-problema`, que necesita el detalle para mostrarlo) y el
 * CONTEO del chip (`/api/clientes/resumen`, que cuenta sobre todas las fichas).
 * Duplicar el cruce dejaría el número y la lista discrepando.
 */

export interface FichaCorreoProblema {
  cliente_id: string
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  email: string
  estado: string
  tipo: string
  fecha: string
}

export async function fichasConCorreoProblema(clientes: Record<string, string>[]): Promise<FichaCorreoProblema[]> {
  const problemas = await problemasGlobal()
  if (problemas.length === 0) return []

  const norm = (s: string | undefined) => (s || '').trim().toLowerCase()
  const porId = new Map(clientes.map(c => [String(c.id), c]))

  const vistos = new Set<string>()
  const out: FichaCorreoProblema[] = []
  for (const p of problemas) {
    // El rebote es propiedad del EMAIL: alertamos a toda ficha que siga usando esa
    // dirección (el registro puede venir de otra ficha del mismo tutor). Dedupe por
    // ficha (queda el problema más reciente).
    const email = norm(p.email)
    if (!email) continue
    const afectados = p.cliente_id && norm(porId.get(String(p.cliente_id))?.email) === email
      ? [porId.get(String(p.cliente_id))!]
      : clientes.filter(c => norm(c.email) === email)
    for (const cli of afectados) {
      const key = String(cli.id)
      if (vistos.has(key)) continue
      vistos.add(key)
      out.push({
        cliente_id: key,
        codigo: cli.codigo || '',
        nombre_mascota: cli.nombre_mascota || '',
        nombre_tutor: cli.nombre_tutor || '',
        email: cli.email || '',
        estado: p.estado,
        tipo: p.tipo || '',
        fecha: p.fecha_actualizacion || p.fecha_envio || '',
      })
    }
  }
  return out
}
