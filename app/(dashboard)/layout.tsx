import Sidebar from '@/components/Sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-60 p-4 pt-16 md:p-8 bg-slate-200 min-h-screen">
        {children}
      </main>
    </div>
  )
}
