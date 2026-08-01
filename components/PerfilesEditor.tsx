'use client'

/**
 * Editor de PERFILES de acceso (Configuración Avanzada → Usuarios, solo el dueño).
 *
 * Un perfil agrupa el nivel de cada módulo: Sin acceso · Visualizador · Editor.
 * A cada usuario se le asigna un perfil; si una persona necesita algo puntual que
 * su perfil no cubre, se le pone una EXCEPCIÓN sobre ese módulo sin tener que
 * inventar un perfil nuevo.
 *
 * API: /api/perfiles (GET/POST/PUT/DELETE) — ver app/api/perfiles/route.ts
 */

import { useEffect, useMemo, useState } from 'react'
import { Button, Card } from '@/components/ui/kit'
import { Modal } from '@/components/ui/Modal'
import { useAccionUnica } from '@/lib/use-accion-unica'

type Nivel = 'none' | 'ver' | 'editar'

type Modulo = { key: string; label: string; grupo: string; descripcion?: string }
type Grupo = { key: string; label: string }
type UsuarioPerfil = { id: string; nombre: string; email: string; activo: boolean }
type Perfil = {
  id: string; slug: string; nombre: string; descripcion: string
  sistema: boolean; editable: boolean; activo: boolean
  permisos: Record<string, Nivel>
  usuarios: UsuarioPerfil[]
}
type Estado = {
  grupos: Grupo[]
  modulos: Modulo[]
  perfiles: Perfil[]
  overrides: Record<string, Record<string, Nivel>>
  usuariosSinPerfil: { id: string; nombre: string; email: string }[]
}

const NIVELES: { value: Nivel; label: string; corto: string }[] = [
  { value: 'none', label: 'Sin acceso', corto: 'Sin acceso' },
  { value: 'ver', label: 'Visualizador', corto: 'Ver' },
  { value: 'editar', label: 'Editor', corto: 'Editar' },
]

const COLOR: Record<Nivel, string> = {
  none: 'bg-gray-100 text-gray-500 border-gray-300',
  ver: 'bg-sky-50 text-sky-700 border-sky-300',
  editar: 'bg-emerald-50 text-emerald-700 border-emerald-300',
}

/** Selector de 3 estados (o 4, si se permite "heredar del perfil"). */
function SelectorNivel({ valor, onChange, disabled, heredado }: {
  valor: Nivel | null
  onChange: (n: Nivel | null) => void
  disabled?: boolean
  /** Si viene, se agrega la opción "Según el perfil" (valor null). */
  heredado?: Nivel
}) {
  const opciones: { value: Nivel | null; label: string }[] = heredado
    ? [{ value: null, label: `Según el perfil (${NIVELES.find(n => n.value === heredado)?.corto})` }, ...NIVELES.map(n => ({ value: n.value as Nivel | null, label: n.corto }))]
    : NIVELES.map(n => ({ value: n.value as Nivel | null, label: n.corto }))

  return (
    <div className="inline-flex rounded-xl border border-gray-300 overflow-hidden bg-white">
      {opciones.map(o => {
        const activo = valor === o.value
        return (
          <button
            key={String(o.value)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-r border-gray-200 last:border-r-0 disabled:opacity-40 ${
              activo
                ? o.value === 'editar' ? 'bg-emerald-600 text-white'
                  : o.value === 'ver' ? 'bg-sky-600 text-white'
                  : o.value === null ? 'bg-brand text-white'
                  : 'bg-gray-500 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export default function PerfilesEditor() {
  const [data, setData] = useState<Estado | null>(null)
  const [selId, setSelId] = useState<string>('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState('')
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [nuevo, setNuevo] = useState({ nombre: '', descripcion: '', copiar_de: '' })
  const [excepcionesDe, setExcepcionesDe] = useState<UsuarioPerfil | null>(null)
  const { ejecutar, procesando } = useAccionUnica()

  useEffect(() => {
    fetch('/api/perfiles')
      .then(r => r.json())
      .then((d: Estado & { error?: string }) => {
        if (d.error) { setError(d.error); return }
        setData(d)
        setSelId(prev => prev || d.perfiles.find(p => p.editable)?.id || d.perfiles[0]?.id || '')
      })
      .catch(() => setError('No se pudieron cargar los perfiles.'))
  }, [])

  const perfil = useMemo(() => data?.perfiles.find(p => p.id === selId) || null, [data, selId])
  const porGrupo = useMemo(() => {
    if (!data) return []
    return data.grupos
      .map(g => ({ ...g, modulos: data.modulos.filter(m => m.grupo === g.key) }))
      .filter(g => g.modulos.length > 0)
  }, [data])

  async function llamar(method: string, body?: unknown, query = '') {
    setError('')
    const r = await fetch(`/api/perfiles${query}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const d = await r.json()
    if (!r.ok) { setError(d.error || 'No se pudo guardar.'); return null }
    setData(d as Estado)
    return d as Estado
  }

  async function setNivel(modulo: string, nivel: Nivel) {
    if (!perfil) return
    setGuardando(modulo)
    // Optimista: el toggle responde al instante y se corrige si el server falla.
    setData(prev => prev && ({
      ...prev,
      perfiles: prev.perfiles.map(p => p.id === perfil.id ? { ...p, permisos: { ...p.permisos, [modulo]: nivel } } : p),
    }))
    await llamar('PUT', { perfil_id: perfil.id, cambios: [{ modulo, nivel }] })
    setGuardando('')
  }

  async function setNivelGrupo(modulos: Modulo[], nivel: Nivel) {
    if (!perfil) return
    setGuardando(modulos[0]?.key || '')
    await llamar('PUT', { perfil_id: perfil.id, cambios: modulos.map(m => ({ modulo: m.key, nivel })) })
    setGuardando('')
  }

  const totalUsuarios = data?.perfiles.reduce((s, p) => s + p.usuarios.length, 0) ?? 0

  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-300 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-brand">Perfiles de acceso</h2>
          <p className="text-xs text-gray-600 mt-0.5">
            Cada persona tiene un perfil, y el perfil define qué módulos puede <b>ver</b> y cuáles puede <b>editar</b>.
            Los cambios se aplican casi al instante. Vos (Administrador) siempre tenés todo.
          </p>
        </div>
        <Button variant="primary" onClick={() => { setNuevo({ nombre: '', descripcion: '', copiar_de: perfil?.id || '' }); setNuevoOpen(true) }}>
          + Nuevo perfil
        </Button>
      </div>

      {error && <div className="px-6 py-2 text-xs text-red-600 bg-red-50 border-b border-red-200">{error}</div>}

      {!data ? (
        <div className="px-6 py-10 text-center text-gray-500 text-sm">Cargando…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr]">
          {/* ── Lista de perfiles ── */}
          <div className="border-b lg:border-b-0 lg:border-r border-gray-300 bg-gray-50">
            <ul className="divide-y divide-gray-200">
              {data.perfiles.map(p => (
                <li key={p.id}>
                  <button
                    onClick={() => setSelId(p.id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${p.id === selId ? 'bg-white border-l-4 border-brand' : 'hover:bg-white/70 border-l-4 border-transparent'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 text-sm">{p.nombre}</span>
                      {!p.editable && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">dueño</span>}
                      {!p.activo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">inactivo</span>}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {p.usuarios.length === 0 ? 'Sin usuarios' : `${p.usuarios.length} ${p.usuarios.length === 1 ? 'usuario' : 'usuarios'}`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {data.usuariosSinPerfil.length > 0 && (
              <div className="px-4 py-3 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-200">
                <b>{data.usuariosSinPerfil.length}</b> usuario(s) sin perfil asignado: {data.usuariosSinPerfil.map(u => u.nombre).join(', ')}.
                Asignáselo desde la tabla de usuarios.
              </div>
            )}
            <div className="px-4 py-3 text-[11px] text-gray-500 border-t border-gray-200">
              {data.perfiles.length} perfiles · {totalUsuarios} usuarios asignados
            </div>
          </div>

          {/* ── Detalle del perfil ── */}
          <div className="p-5">
            {!perfil ? (
              <div className="text-sm text-gray-500">Elegí un perfil de la lista.</div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-brand">{perfil.nombre}</h3>
                    <p className="text-xs text-gray-600 mt-0.5 max-w-xl">{perfil.descripcion || 'Sin descripción.'}</p>
                  </div>
                  {perfil.editable && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        disabled={procesando}
                        onClick={() => ejecutar(async () => { await llamar('PUT', { perfil_id: perfil.id, activo: !perfil.activo }) })}
                      >
                        {perfil.activo ? 'Desactivar' : 'Activar'}
                      </Button>
                      {!perfil.sistema && (
                        <Button
                          variant="danger"
                          disabled={procesando}
                          onClick={() => ejecutar(async () => {
                            if (!confirm(`¿Eliminar el perfil "${perfil.nombre}"?`)) return
                            const d = await llamar('DELETE', undefined, `?id=${perfil.id}`)
                            if (d) setSelId(d.perfiles[0]?.id || '')
                          })}
                        >
                          Eliminar
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {!perfil.editable ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    El perfil <b>Administrador</b> tiene acceso total a todos los módulos y es el único que entra a
                    Configuración Avanzada (donde se editan estos permisos). No se puede modificar ni eliminar, a
                    propósito: es lo que evita que alguien se quite a sí mismo el acceso o se escale privilegios.
                  </div>
                ) : (
                  <div className="space-y-5">
                    {porGrupo.map(g => (
                      <div key={g.key} className="rounded-2xl border border-gray-300 overflow-hidden">
                        <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-300">
                          <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{g.label}</h4>
                          <div className="flex items-center gap-1 text-[11px] text-gray-500">
                            <span className="hidden sm:inline">Todo el grupo:</span>
                            {NIVELES.map(n => (
                              <button
                                key={n.value}
                                type="button"
                                onClick={() => setNivelGrupo(g.modulos, n.value)}
                                className="px-2 py-0.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100"
                              >
                                {n.corto}
                              </button>
                            ))}
                          </div>
                        </div>
                        <ul className="divide-y divide-gray-200">
                          {g.modulos.map(m => (
                            <li key={m.key} className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
                              <div className="min-w-[200px]">
                                <div className="text-sm font-medium text-gray-900">{m.label}</div>
                                {m.descripcion && <div className="text-[11px] text-gray-500 mt-0.5">{m.descripcion}</div>}
                              </div>
                              <SelectorNivel
                                valor={perfil.permisos[m.key] ?? 'none'}
                                disabled={guardando === m.key}
                                onChange={n => n && setNivel(m.key, n)}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Usuarios con este perfil ── */}
                <div className="mt-6 rounded-2xl border border-gray-300 overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-300">
                    <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Usuarios con este perfil</h4>
                  </div>
                  {perfil.usuarios.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-gray-500">
                      Nadie tiene este perfil todavía. Se asigna al crear o editar un usuario, en la tabla de arriba.
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-200">
                      {perfil.usuarios.map(u => {
                        const exc = data.overrides[u.id] || {}
                        const cuantas = Object.keys(exc).length
                        return (
                          <li key={u.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <div className="text-sm text-gray-900">
                                {u.nombre} {!u.activo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">inactivo</span>}
                              </div>
                              <div className="text-[11px] text-gray-500">{u.email}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {cuantas > 0 && (
                                <span className="text-[11px] px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700">
                                  {cuantas} excepción{cuantas === 1 ? '' : 'es'}
                                </span>
                              )}
                              <Button variant="secondary" onClick={() => setExcepcionesDe(u)}>Excepciones</Button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: nuevo perfil ── */}
      <Modal open={nuevoOpen} onClose={() => setNuevoOpen(false)} title="Nuevo perfil" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
            <input
              value={nuevo.nombre}
              onChange={e => setNuevo(f => ({ ...f, nombre: e.target.value }))}
              placeholder="Ej: Contador, Supervisor de turno, Marketing"
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Descripción (opcional)</label>
            <input
              value={nuevo.descripcion}
              onChange={e => setNuevo(f => ({ ...f, descripcion: e.target.value }))}
              placeholder="Para qué sirve este perfil"
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Partir desde</label>
            <select
              value={nuevo.copiar_de}
              onChange={e => setNuevo(f => ({ ...f, copiar_de: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm bg-white"
            >
              <option value="">Todo cerrado (abrir a mano)</option>
              {data?.perfiles.filter(p => p.editable).map(p => (
                <option key={p.id} value={p.id}>Copiar los permisos de «{p.nombre}»</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setNuevoOpen(false)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={procesando || !nuevo.nombre.trim()}
              onClick={() => ejecutar(async () => {
                const d = await llamar('POST', nuevo)
                if (d) {
                  const creado = d.perfiles.find(p => p.nombre === nuevo.nombre.trim())
                  if (creado) setSelId(creado.id)
                  setNuevoOpen(false)
                }
              })}
            >
              Crear perfil
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: excepciones de una persona ── */}
      <Modal open={!!excepcionesDe} onClose={() => setExcepcionesDe(null)} title={`Excepciones de ${excepcionesDe?.nombre || ''}`} size="lg">
        {excepcionesDe && data && perfil && (
          <div className="space-y-4">
            <p className="text-xs text-gray-600">
              Solo para casos puntuales: lo que dejes en <b>«Según el perfil»</b> sigue lo que diga «{perfil.nombre}».
              Cualquier otra opción vale <b>solo para esta persona</b> y pisa al perfil.
            </p>
            {porGrupo.map(g => (
              <div key={g.key} className="rounded-2xl border border-gray-300 overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-300 text-xs font-semibold text-gray-700 uppercase tracking-wide">{g.label}</div>
                <ul className="divide-y divide-gray-200">
                  {g.modulos.map(m => {
                    const heredado = perfil.permisos[m.key] ?? 'none'
                    const actual = data.overrides[excepcionesDe.id]?.[m.key] ?? null
                    return (
                      <li key={m.key} className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-sm text-gray-800">{m.label}</div>
                        <div className="flex items-center gap-2">
                          {actual && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${COLOR[actual]}`}>excepción</span>}
                          <SelectorNivel
                            valor={actual}
                            heredado={heredado}
                            disabled={guardando === `exc:${m.key}`}
                            onChange={async n => {
                              setGuardando(`exc:${m.key}`)
                              await llamar('PUT', { usuario_id: excepcionesDe.id, modulo: m.key, nivel: n })
                              setGuardando('')
                            }}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setExcepcionesDe(null)}>Listo</Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  )
}
