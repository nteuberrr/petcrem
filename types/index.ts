export type Especie = {
  id: string
  nombre: string
  letra: string
  activo: boolean
}

export type TipoServicio = {
  id: string
  nombre: string
  codigo: string
  activo: boolean
}

export type PrecioTramo = {
  id: string
  peso_min: number
  peso_max: number
  precio_ci: number
  precio_cp: number
  precio_sd: number
}

export type Cliente = {
  id: string
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  direccion_retiro: string
  direccion_despacho: string
  misma_direccion: boolean
  comuna: string
  fecha_retiro: string
  especie: string
  letra_especie: string
  peso_declarado: number
  peso_ingreso?: number
  tipo_servicio: string
  codigo_servicio: string
  estado: 'pendiente' | 'cremado' | 'despachado'
  ciclo_id: string
  fecha_creacion: string
}

export type Ciclo = {
  id: string
  fecha: string
  numero_ciclo: number
  litros_inicio: number
  litros_fin: number
  mascotas_ids: string[]
  comentarios: string
  fecha_creacion: string
}

export type Veterinario = {
  id: string
  nombre: string
  direccion: string
  telefono: string
  correo: string
  nombre_contacto: string
  cargo_contacto: string
  comuna: string
  rut: string
  razon_social: string
  giro: string
  tipo_precios: 'precios_convenio' | 'precios_especiales'
  precios_especiales: PrecioTramo[] | null
  activo: boolean
  fecha_creacion: string
}

export type Producto = {
  id: string
  nombre: string
  precio: number
  foto_url: string
  activo: boolean
  fecha_creacion: string
}

export type OtroServicio = {
  id: string
  nombre: string
  precio: number
  activo: boolean
  fecha_creacion: string
}

export type KPIs = {
  total_cremaciones_mes: number
  pendientes: number
  ciclos_mes: number
  litros_mes: number
  ingresos_mes: number
}
