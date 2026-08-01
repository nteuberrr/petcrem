'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, Button } from '@/components/ui/kit'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { fmtPrecio } from '@/lib/format'
import { useAccionUnica } from '@/lib/use-accion-unica'
import { InfoTip } from '@/components/ui/InfoTip'
import { ISAPRES, NOMBRES_AFP } from '@/lib/remuneraciones/tablas'
import { formatearRut, validarRut } from '@/lib/rut'
import { BANCOS_CL, TIPOS_CUENTA } from '@/lib/bancos-cl'
import type { Empleado } from './tipos-ui'

const VACIO: Partial<Empleado> = {
  nombre_completo: '', rut: '', cargo: '', unidad_negocio: 'CASA MATRIZ',
  tipo_contrato: 'plazo_fijo', jornada_semanal_horas: 42, sueldo_base: 0,
  modalidad_variable: 'meta_liquido', valor_por_cremacion: 1750,
  afp: 'modelo', prevision_salud: 'fonasa', plan_salud_uf: 0, apv_monto: 0,
  nacionalidad: 'Chilena', activo: true, haberes_no_imponibles: [],
}

export default function EmpleadosTab() {
  const [empleados, setEmpleados] = useState<Empleado[] | null>(null)
  const [editando, setEditando] = useState<Partial<Empleado> | null>(null)
  const [err, setErr] = useState('')

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/remuneraciones/empleados', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'No se pudo cargar'); setEmpleados([]) }
      else setEmpleados(d.empleados || [])
    } catch { setErr('Error de red'); setEmpleados([]) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-brand">
          Equipo
          <InfoTip titulo="Qué se guarda acá">
            El contrato y la previsión de cada trabajador: es lo que alimenta la liquidación y la declaración de
            cotizaciones.
            <br /><br />
            <b>Nadie se borra</b>, se desactiva — borrar rompería el histórico de liquidaciones ya pagadas.
            <br /><br />
            El <b>variable por cremación</b> tiene tres modos: «meta de líquido» resuelve el bono necesario para que
            el líquido dé sueldo base + valor × cremaciones (es el acuerdo con Oscar y Juan); «monto directo» paga ese
            valor como haber imponible y el líquido sale el que salga.
          </InfoTip>
        </h2>
        <Button variant="primary" onClick={() => setEditando({ ...VACIO })}>+ Nuevo empleado</Button>
      </Card>

      {err && <Card className="border-red-300 bg-red-50 p-4 text-sm text-red-700">{err}</Card>}
      {!empleados && <TableSkeleton rows={3} />}

      {empleados && empleados.length === 0 && (
        <Card className="p-8 text-center text-sm text-gray-600">
          Todavía no hay empleados cargados.
        </Card>
      )}

      {empleados && empleados.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-gray-300 bg-cream text-left text-xs uppercase tracking-wide text-gray-600">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-3">RUT</th>
                <th className="px-3">Cargo</th>
                <th className="px-3">Contrato</th>
                <th className="px-3 text-right">Sueldo base</th>
                <th className="px-3">Previsión</th>
                <th className="px-3">Variable</th>
                <th className="px-3"></th>
              </tr>
            </thead>
            <tbody>
              {empleados.map(e => (
                <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-gray-900">{e.nombre_completo}</span>
                    {!e.activo && <span className="ml-2"><Badge variant="gray">inactivo</Badge></span>}
                  </td>
                  <td className="px-3 font-mono text-xs">{e.rut || '—'}</td>
                  <td className="px-3">{e.cargo || '—'}</td>
                  <td className="px-3">{e.tipo_contrato === 'indefinido' ? 'Indefinido' : 'Plazo fijo'}</td>
                  <td className="px-3 text-right tabular-nums">{fmtPrecio(e.sueldo_base)}</td>
                  <td className="px-3 text-xs">
                    {NOMBRES_AFP[e.afp] || e.afp || '—'}
                    {' · '}
                    {e.prevision_salud === 'fonasa' ? 'Fonasa'
                      : e.prevision_salud === 'isapre' ? (e.isapre_codigo || 'Isapre')
                      : 'Sin previsión'}
                  </td>
                  <td className="px-3 text-xs">
                    {e.modalidad_variable === 'meta_liquido' ? `${fmtPrecio(e.valor_por_cremacion)} líquidos / cremación`
                      : e.modalidad_variable === 'monto_directo' ? `${fmtPrecio(e.valor_por_cremacion)} imponibles / cremación`
                      : 'sin variable'}
                  </td>
                  <td className="px-3 text-right">
                    <Button variant="ghost" onClick={() => setEditando(e)}>Editar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editando && (
        <ModalEmpleado
          empleado={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={async () => { setEditando(null); await cargar() }}
        />
      )}
    </div>
  )
}

function ModalEmpleado({ empleado, onCerrar, onGuardado }: {
  empleado: Partial<Empleado>
  onCerrar: () => void
  onGuardado: () => Promise<void>
}) {
  const [f, setF] = useState<Partial<Empleado>>({ ...empleado })
  const [err, setErr] = useState('')
  const { ejecutar, procesando } = useAccionUnica()
  const esNuevo = !empleado.id

  const set = <K extends keyof Empleado>(k: K, v: Empleado[K]) => setF(prev => ({ ...prev, [k]: v }))

  const rutMalo = !!f.rut && !validarRut(f.rut)

  async function guardar() {
    setErr('')
    if (!f.nombre_completo?.trim()) { setErr('El nombre completo es obligatorio.'); return }
    if (rutMalo) { setErr('El RUT no es válido: revisa el dígito verificador.'); return }

    const { id, ...datos } = f
    const r = await fetch('/api/remuneraciones/empleados', {
      method: esNuevo ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(esNuevo ? datos : { id, ...datos }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(d.error || 'No se pudo guardar'); return }
    await onGuardado()
  }

  return (
    <Modal open onClose={onCerrar} title={esNuevo ? 'Nuevo empleado' : f.nombre_completo || 'Empleado'} size="3xl">
      <div className="space-y-5">
        <Seccion titulo="Datos personales">
          <Txt label="Nombre completo (como sale en la liquidación)" value={f.nombre_completo || ''} onChange={v => set('nombre_completo', v)} ancho="sm:col-span-2" />
          <Txt label="RUT" value={f.rut || ''} onChange={v => set('rut', v)} onBlur={() => f.rut && validarRut(f.rut) && set('rut', formatearRut(f.rut))} error={rutMalo ? 'DV incorrecto' : ''} />
          <Txt label="Fecha de nacimiento" type="date" value={f.fecha_nacimiento || ''} onChange={v => set('fecha_nacimiento', v)} />
          <Txt label="Nacionalidad" value={f.nacionalidad || ''} onChange={v => set('nacionalidad', v)} />
          <Txt label="Correo" type="email" value={f.email || ''} onChange={v => set('email', v)} />
          <Txt label="Teléfono" value={f.telefono || ''} onChange={v => set('telefono', v)} />
          <Txt label="Dirección" value={f.direccion || ''} onChange={v => set('direccion', v)} />
          <Txt label="Comuna" value={f.comuna || ''} onChange={v => set('comuna', v)} />
        </Seccion>

        <Seccion titulo="Contrato">
          <Txt label="Cargo" value={f.cargo || ''} onChange={v => set('cargo', v)} />
          <Txt label="Unidad de negocio" value={f.unidad_negocio || ''} onChange={v => set('unidad_negocio', v)} />
          <Sel label="Tipo de contrato" value={f.tipo_contrato || 'plazo_fijo'} onChange={v => set('tipo_contrato', v as Empleado['tipo_contrato'])}
            opciones={[['plazo_fijo', 'Plazo fijo'], ['indefinido', 'Indefinido']]} />
          <Num label="Jornada semanal (horas)" value={f.jornada_semanal_horas ?? 42} onChange={v => set('jornada_semanal_horas', v)} pie="42 h desde abril 2026" />
          <Txt label="Fecha de ingreso" type="date" value={f.fecha_ingreso || ''} onChange={v => set('fecha_ingreso', v)} />
          <Txt label="Fecha de término" type="date" value={f.fecha_termino || ''} onChange={v => set('fecha_termino', v)} />
        </Seccion>

        <Seccion titulo="Remuneración">
          <Num label="Sueldo base" value={f.sueldo_base ?? 0} onChange={v => set('sueldo_base', v)} />
          <Sel label="Variable por cremación" value={f.modalidad_variable || 'ninguna'} onChange={v => set('modalidad_variable', v as Empleado['modalidad_variable'])}
            opciones={[
              ['meta_liquido', 'Meta de líquido (se resuelve el bono)'],
              ['monto_directo', 'Monto directo imponible'],
              ['ninguna', 'Sin variable'],
            ]}
            pie={f.modalidad_variable === 'meta_liquido'
              ? 'El sistema busca el bono que deja el líquido en sueldo base + valor × cremaciones.'
              : undefined} />
          <Num label="Valor por cremación" value={f.valor_por_cremacion ?? 0} onChange={v => set('valor_por_cremacion', v)} />
        </Seccion>

        <Seccion titulo="Previsión">
          <Sel label="AFP" value={f.afp || ''} onChange={v => set('afp', v)}
            opciones={[['', '— sin AFP —'], ...Object.entries(NOMBRES_AFP)]} />
          <Sel label="Salud" value={f.prevision_salud || 'fonasa'} onChange={v => set('prevision_salud', v as Empleado['prevision_salud'])}
            opciones={[['fonasa', 'Fonasa'], ['isapre', 'Isapre'], ['no_tiene', 'No tiene']]}
            pie={f.prevision_salud === 'no_tiene'
              ? 'Se descuenta el 7% igual y se le entrega aparte como reembolso.'
              : undefined} />
          {f.prevision_salud === 'isapre' && (
            <>
              <Sel label="Isapre" value={f.isapre_codigo || ''} onChange={v => set('isapre_codigo', v)}
                opciones={[['', '— elegir —'], ...ISAPRES.map(i => [i, i] as [string, string])]} />
              <Num label="Plan pactado (UF)" value={f.plan_salud_uf ?? 0} onChange={v => set('plan_salud_uf', v)} paso="0.01" />
            </>
          )}
          <Num label="APV mensual" value={f.apv_monto ?? 0} onChange={v => set('apv_monto', v)} />
          <Txt label="Institución APV" value={f.apv_institucion || ''} onChange={v => set('apv_institucion', v)} />
        </Seccion>

        <Seccion titulo="Datos de pago">
          <Sel label="Banco" value={f.banco || ''} onChange={v => set('banco', v)}
            opciones={[['', '— elegir —'], ...BANCOS_CL.map(b => [b, b] as [string, string])]} />
          <Sel label="Tipo de cuenta" value={f.tipo_cuenta || ''} onChange={v => set('tipo_cuenta', v)}
            opciones={[['', '— elegir —'], ...TIPOS_CUENTA.map(t => [t, t] as [string, string])]} />
          <Txt label="Número de cuenta" value={f.numero_cuenta || ''} onChange={v => set('numero_cuenta', v)} />
        </Seccion>

        <Seccion titulo="Otros">
          <Txt label="Notas" value={f.notas || ''} onChange={v => set('notas', v)} ancho="sm:col-span-2" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.activo !== false} onChange={e => set('activo', e.target.checked)} className="h-4 w-4" />
            Activo (se le liquida sueldo cada mes)
          </label>
        </Seccion>

        {err && <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{err}</p>}

        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button variant="primary" disabled={procesando} onClick={() => ejecutar(guardar)}>
            {procesando ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand">{titulo}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function Txt({ label, value, onChange, onBlur, type = 'text', ancho = '', error = '' }: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void
  type?: string; ancho?: string; error?: string
}) {
  return (
    <label className={`block ${ancho}`}>
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}
        className={`w-full rounded-xl border px-3 py-2 text-sm ${error ? 'border-red-400' : 'border-gray-300'}`}
      />
      {error && <span className="mt-0.5 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

function Num({ label, value, onChange, pie, paso = '1' }: {
  label: string; value: number; onChange: (v: number) => void; pie?: string; paso?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        type="number" step={paso} value={value}
        onChange={e => onChange(Number(e.target.value) || 0)}
        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
      />
      {pie && <span className="mt-0.5 block text-xs text-gray-500">{pie}</span>}
    </label>
  )
}

function Sel({ label, value, onChange, opciones, pie }: {
  label: string; value: string; onChange: (v: string) => void
  opciones: [string, string][]; pie?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
      >
        {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      {pie && <span className="mt-0.5 block text-xs text-gray-500">{pie}</span>}
    </label>
  )
}
