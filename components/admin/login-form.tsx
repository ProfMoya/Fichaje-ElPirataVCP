'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Lock, ShieldCheck, User } from 'lucide-react'
import { iniciarSesion } from '@/app/actions/admin'
import { Aviso, Boton, Field } from '@/components/admin/ui'
import { cn } from '@/lib/utils'

export function AdminLoginForm({ avisoInicial }: { avisoInicial?: string }) {
  const router = useRouter()
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(avisoInicial ?? null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        const res = await iniciarSesion(user, password)
        if (!res.ok) {
          setError(res.message)
          setPassword('')
          return
        }
        // La sesión vive en una cookie httpOnly: refrescar hace que el
        // componente de servidor vuelva a leerla y renderice el panel.
        router.refresh()
      } catch {
        setError('No pudimos conectar con el servidor. Revisá tu conexión y volvé a intentar.')
      }
    })
  }

  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <Link
        href="/"
        className="glass absolute top-6 left-5 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-light text-warning transition-all duration-200 hover:border-warning/60 hover:glow-edge-warning active:scale-[0.97] sm:left-8"
      >
        <ArrowLeft className="size-4" strokeWidth={1.6} />
        Volver al fichaje
      </Link>

      <form
        onSubmit={handleSubmit}
        className={cn('glass glow-edge animate-rise w-full max-w-sm rounded-3xl p-7 sm:p-9', error && 'animate-shake')}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="glass glow-edge flex size-14 items-center justify-center rounded-2xl text-primary">
            <ShieldCheck className="size-7" strokeWidth={1.5} />
          </span>
          <div>
            <h1 className="text-2xl font-light tracking-tight">Panel MAGA</h1>
            <p className="mt-1 text-sm font-light text-muted-foreground">
              Acceso restringido al personal autorizado
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <Campo icon={<User className="size-4" strokeWidth={1.6} />}>
            <Field value={user} onChange={setUser} placeholder="Usuario" autoFocus />
          </Campo>
          <Campo icon={<Lock className="size-4" strokeWidth={1.6} />}>
            <Field value={password} onChange={setPassword} placeholder="Contraseña" type="password" />
          </Campo>
        </div>

        {error && (
          <div className="mt-4">
            <Aviso tipo="error">{error}</Aviso>
          </div>
        )}

        <Boton type="submit" variant="primary" loading={pending} className="mt-6 w-full py-3.5">
          {pending ? 'Verificando…' : 'Entrar'}
        </Boton>
      </form>
    </main>
  )
}

function Campo({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-primary/80">{icon}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}
