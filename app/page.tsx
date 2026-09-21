'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ChevronRight, Fingerprint, Loader2, ShieldCheck, Timer } from 'lucide-react'
import { consultarHoras, registrarFichaje } from '@/app/actions/kiosco'
import { ClockDisplay } from '@/components/clock-display'
import { HoursPanel } from '@/components/hours-panel'
import { PinDisplay } from '@/components/pin-display'
import { PinKeypad } from '@/components/pin-keypad'
import { PunchFeedback, type Feedback } from '@/components/punch-feedback'
import { PIN_LENGTH, type Summary } from '@/lib/timeclock'
import { zonedNow } from '@/lib/tz'
import { cn } from '@/lib/utils'

type Mode = 'fichar' | 'consultar'

type HoursView = { name: string; department: string; hourlyWage: number; summary: Summary; dayKey: string }

/**
 * Cada error tiene su propio encabezado e ícono. Frente a una terminal, "PIN
 * no reconocido" y "sin conexión" piden cosas distintas de la persona: una se
 * resuelve tecleando de nuevo, la otra no.
 */
const ERRORES: Record<string, { title: string; icon: 'alerta' | 'reloj' | 'conexion' }> = {
  formato: { title: 'PIN incompleto', icon: 'alerta' },
  desconocido: { title: 'PIN no reconocido', icon: 'alerta' },
  inactivo: { title: 'Legajo dado de baja', icon: 'alerta' },
  muy_pronto: { title: 'Esperá un momento', icon: 'reloj' },
  excedido: { title: 'Turno sin cerrar', icon: 'alerta' },
  saturado: { title: 'Demasiados intentos', icon: 'alerta' },
  servidor: { title: 'Sin conexión', icon: 'conexion' },
}

const RESET_EXITO = 4500
// Con un aviso de salida olvidada hace falta más tiempo para leerlo.
const RESET_AVISO = 9000
const RESET_ERROR = 5000

export default function KioskPage() {
  const [pin, setPin] = useState('')
  const [mode, setMode] = useState<Mode>('fichar')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [hours, setHours] = useState<HoursView | null>(null)
  const [pending, startTransition] = useTransition()

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // `pending` de useTransition no cambia en el mismo tick, así que el envío
  // automático al cuarto dígito y el botón de confirmar podrían disparar dos
  // peticiones por el mismo PIN. Este ref cierra la puerta de inmediato.
  const enviando = useRef(false)

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  const reset = useCallback(() => {
    clearTimer()
    setPin('')
    setMode('fichar')
    setFeedback(null)
  }, [clearTimer])

  const mostrarError = useCallback(
    (code: string, message: string) => {
      const meta = ERRORES[code] ?? ERRORES.servidor
      setFeedback({ type: 'error', title: meta.title, message, icon: meta.icon })
      setPin('')
      clearTimer()
      timer.current = setTimeout(reset, RESET_ERROR)
    },
    [clearTimer, reset],
  )

  const submit = useCallback(() => {
    if (enviando.current || pin.length !== PIN_LENGTH) return
    enviando.current = true
    const enviado = pin
    const consulta = mode === 'consultar'

    startTransition(async () => {
      try {
        if (consulta) {
          const res = await consultarHoras(enviado)
          if (!res.ok) return mostrarError(res.code, res.message)
          setHours({
            name: res.name,
            department: res.department,
            hourlyWage: res.hourlyWage,
            summary: res.summary,
            dayKey: res.dayKey,
          })
          setPin('')
          setMode('fichar')
          return
        }

        const res = await registrarFichaje(enviado)
        if (!res.ok) return mostrarError(res.code, res.message)

        setFeedback({
          type: 'success',
          name: res.name,
          kind: res.kind,
          minute: res.minute,
          workedToday: res.workedToday,
          turno: res.turno,
          olvidados: res.olvidados,
        })
        setPin('')
        clearTimer()
        timer.current = setTimeout(reset, res.olvidados.length > 0 ? RESET_AVISO : RESET_EXITO)
      } catch {
        // La server action ni siquiera llegó a ejecutarse: red caída,
        // función dormida o deploy en curso.
        mostrarError(
          'servidor',
          'No pudimos comunicarnos con el servidor. Revisá la conexión de la terminal y volvé a intentar.',
        )
      } finally {
        enviando.current = false
      }
    })
  }, [pin, mode, mostrarError, clearTimer, reset])

  // En una terminal, pulsar el cuarto dígito y que pase algo es el gesto
  // esperado; el botón de confirmar queda igual para quien lo busque.
  useEffect(() => {
    if (pin.length === PIN_LENGTH && !pending && !feedback) submit()
  }, [pin, pending, feedback, submit])

  return (
    <main className="relative z-10 flex min-h-dvh flex-col px-5 pb-10 sm:px-8">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-3">
          <span className="glass flex size-16 items-center justify-center overflow-hidden rounded-xl">
            <Image src="/Logopirata.png" alt="El Pirata Villa Carlos Paz" width={249} height={242} className="size-full object-cover" priority />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-medium tracking-wide">Fichaje - El Pirata VCP</p>
            <p className="text-sm font-light tracking-[0.22em] text-muted-foreground uppercase">
              Terminal 01
            </p>
          </div>
        </div>

        <Link
          href="/admin"
          className="glass group flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-light text-muted-foreground transition-all duration-200 hover:border-primary/55 hover:text-foreground hover:glow-edge focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97] sm:px-5"
        >
          <ShieldCheck className="size-4 text-primary" strokeWidth={1.6} />
          <span className="hidden sm:inline">Panel de administración</span>
          <span className="sm:hidden">Admin</span>
          <ChevronRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </header>

      <div className="flex flex-1 items-center justify-center py-6">
        {feedback ? (
          <div className="flex w-full flex-col items-center gap-8">
            <PunchFeedback feedback={feedback} dayKey={zonedNow().dayKey} />
            <button
              type="button"
              onClick={reset}
              className="glass rounded-full px-6 py-3 text-sm font-light tracking-wide text-warning transition-all duration-200 hover:border-warning/60 hover:glow-edge-warning focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97]"
            >
              Volver al teclado
            </button>
          </div>
        ) : (
          <div className="flex w-full max-w-md flex-col items-center gap-7 sm:gap-9">
            <ClockDisplay />

            <div className="flex w-full flex-col items-center gap-4">
              <div className={cn('flex items-center gap-2', mode === 'consultar' ? 'text-warning' : 'text-primary')}>
                <Fingerprint className="size-4" strokeWidth={1.6} />
                <p className="text-sm tracking-[0.24em] uppercase">
                  {mode === 'consultar' ? 'Identificate para ver tus horas' : 'Ingresá tu PIN'}
                </p>
              </div>

              <PinDisplay value={pin} length={PIN_LENGTH} />

              <p className="text-center text-sm font-light text-muted-foreground">
                {mode === 'consultar'
                  ? 'Ingresá tu PIN para consultar tu resumen de horas'
                  : 'Ingresá tu PIN para registrar tu entrada o tu salida'}
              </p>
            </div>

            <PinKeypad
              value={pin}
              onChange={setPin}
              onSubmit={submit}
              maxLength={PIN_LENGTH}
              disabled={pending}
            />

            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setMode((m) => (m === 'consultar' ? 'fichar' : 'consultar'))
                setPin('')
              }}
              className={cn(
                'glass flex w-full items-center justify-center gap-3 rounded-2xl py-4 text-sm font-light tracking-wide transition-all duration-200',
                'hover:border-warning/50 hover:text-warning focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.98] disabled:opacity-50',
                mode === 'consultar' ? 'border-warning/55 text-warning glow-edge-warning' : 'text-muted-foreground',
              )}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Timer className="size-4" strokeWidth={1.6} />
              )}
              {mode === 'consultar' ? 'Cancelar consulta' : 'Consultar mis horas trabajadas'}
            </button>
          </div>
        )}
      </div>

      {hours && (
        <HoursPanel
          name={hours.name}
          department={hours.department}
          hourlyWage={hours.hourlyWage}
          summary={hours.summary}
          dayKey={hours.dayKey}
          onClose={() => setHours(null)}
        />
      )}
    </main>
  )
}
