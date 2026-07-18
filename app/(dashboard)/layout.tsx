import Sidebar from '@/components/Sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      {/* min-w-0 es clave: sin él, el flex item `main` toma el ancho intrínseco
          de las tablas anchas (min-w-[…px]) y empuja la página más ancha que el
          viewport → en móvil se veía "zoomeada"/corrida al cambiar de sección.
          Con min-w-0 el item se encoge y las tablas scrollean en su propio wrapper. */}
      <main className="flex-1 min-w-0 max-w-full md:ml-60 p-4 pt-16 md:p-8 bg-slate-200 min-h-screen">
        {/* Contenedor centrado con tope de ancho: en monitores muy anchos el
            contenido no se estira a lo bruto (el fondo slate sí es full-width).
            Las páginas con su propio max-w menor siguen mandando adentro. */}
        <div className="mx-auto w-full max-w-[1600px]">
          {children}
        </div>
      </main>
    </div>
  )
}
