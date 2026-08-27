import { cargarPanel } from '@/app/actions/admin'
import { AdminDashboard } from '@/components/admin/dashboard'
import { AdminLoginForm } from '@/components/admin/login-form'
import { readSession } from '@/lib/session'

/**
 * La sesión se resuelve en el servidor antes de renderizar nada: el navegador
 * no recibe ni un byte de datos de empleados si la cookie no es válida.
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Panel - El Pirata VCP · Administración',
  robots: { index: false, follow: false },
}

export default async function AdminPage() {
  const session = await readSession()
  if (!session) return <AdminLoginForm />

  const panel = await cargarPanel()
  if (!panel.ok) {
    // Sesión válida pero la base no responde: no tiene sentido mandar a
    // iniciar sesión de nuevo, el problema es otro y hay que decirlo.
    return <AdminLoginForm avisoInicial={panel.message} />
  }

  return (
    <AdminDashboard
      initial={panel.data}
      username={session.username}
      mustChangePassword={session.mustChangePassword}
    />
  )
}
