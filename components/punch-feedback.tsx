'use client'

import { ArrowDownLeft, ArrowUpRight, Clock3, ShieldAlert, WifiOff } from 'lucide-react'
import { formatDuration, formatLongDate, formatTime } from '@/lib/timeclock'
import { cn } from '@/lib/utils'

export type Feedback =
  | { type: 'success'; name: string; kind: 'in' | 'out'; minute: number; workedToday: number }
  | { type: 'error'; title: string; message: string; icon?: 'alerta' | 'reloj' | 'conexion' }

const ICONS = {
  alerta: ShieldAlert,
  reloj: Clock3,
  conexion: WifiOff,
}

export function PunchFeedback({ feedback, dayKey }: { feedback: Feedback; dayKey: string }) {
  const ok = feedback.type === 'success'
  const ErrorIcon = ok ? ShieldAlert : ICONS[feedback.icon ?? 'alerta']

  return (
    <div className="animate-rise flex w-full max-w-lg flex-col items-center gap-8 text-center">
      <div className="relative flex size-28 items-center justify-center sm:size-32">
        <span
          className={cn(
            'absolute inset-0 rounded-full border',
            ok ? 'animate-ring border-primary/60' : 'border-destructive/50',
          )}
        />
        <span
          className={cn(
            'glass flex size-full items-center justify-center rounded-full',
            ok ? 'border-primary/50 glow-edge-strong text-primary' : 'border-destructive/60 text-destructive',
          )}
        >
          {ok ? (
            feedback.kind === 'in' ? (
              <ArrowDownLeft className="size-12" strokeWidth={1.5} />
            ) : (
              <ArrowUpRight className="size-12" strokeWidth={1.5} />
            )
          ) : (
            <ErrorIcon className="size-12" strokeWidth={1.5} />
          )}
        </span>
      </div>

      {feedback.type === 'success' ? (
        <div className="flex flex-col items-center gap-4">
          <h2 className="text-balance text-3xl font-light tracking-tight sm:text-5xl">
            ¡Hola, <span className="font-medium">{feedback.name.split(' ')[0]}</span>!
          </h2>
          <p className="text-lg tracking-[0.28em] text-primary uppercase sm:text-xl">
            {feedback.kind === 'in' ? 'Entrada registrada' : 'Salida registrada'}
          </p>
          <p className="text-glow tnum font-mono text-[clamp(3rem,11vw,7rem)] leading-none font-medium">
            {formatTime(feedback.minute)}
          </p>
          {feedback.kind === 'out' && (
            <p className="glass rounded-full px-5 py-2 text-sm font-light tracking-wide text-primary">
              Jornada de hoy: {formatDuration(feedback.workedToday)}
            </p>
          )}
          <p className="text-sm font-light tracking-wide text-muted-foreground sm:text-base">
            {formatLongDate(dayKey)}
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <h2 className="text-balance text-3xl font-light tracking-tight text-destructive sm:text-4xl">
            {feedback.title}
          </h2>
          <p className="max-w-md text-pretty text-base font-light text-muted-foreground">
            {feedback.message}
          </p>
        </div>
      )}
    </div>
  )
}
