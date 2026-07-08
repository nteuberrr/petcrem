/**
 * Sitio público — textos editables de páginas fijas (web_paginas del panel Web).
 * En las plantillas hay marcadores <!--PAG:pagina.clave--> en el inner de ciertos
 * elementos; acá se reemplazan por el contenido del bloque correspondiente.
 * Si el bloque no existe, se deja vacío (el equipo lo controla desde el panel).
 */

type Bloque = Record<string, string>

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderTextos(html: string, bloques: Bloque[]): string {
  return html.replace(/<!--PAG:([a-z0-9_.]+)-->/gi, (_m, id: string) => {
    const dot = id.indexOf('.')
    const pagina = id.slice(0, dot)
    const clave = id.slice(dot + 1)
    const b = bloques.find(x => x.pagina === pagina && x.clave === clave)
    return b ? esc(b.contenido) : ''
  })
}
