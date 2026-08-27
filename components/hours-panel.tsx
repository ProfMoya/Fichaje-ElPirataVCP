'use client'

import { useEffect, useRef } from 'react'
import { Activity, CalendarRange, Clock3, Repeat, Wallet, X } from 'lucide-react'
import {
  estimatedPay,
  formatCurrency,
  formatDuration,
  formatLongDate,
  formatShortDate,
  formatTimeLabel,
  formatWeekday,
  type Summary,
} from '@/lib/timeclock'

export function HoursPanel({
  name,
  department,
  hourlyWage,
  summary,
  dayKey,
  onClose,
}: {
  name: string
  department: string
  hourlyWage: number
  summary: Summary
  dayKey: string
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const turnosHoy = summary.days.filter((d) => d.day === dayKey).length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    // El foco entra al diálogo: si no, el teclado del kiosco sigue escribiendo
    // dígitos en el PIN que quedó detrás.
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Mis horas trabajadas"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass animate-rise glow-edge relative my-auto w-full max-w-2xl rounded-3xl p-6 sm:p-9">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="glass absolute top-5 right-5 flex size-10 items-center justify-center rounded-full text-muted-foreground transition-all duration-200 hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-95"
        >
          <X className="size-5" strokeWidth={1.5} />
        </button>

        <header className="flex flex-col gap-1 pr-12">
          <p className="text-xs tracking-[0.3em] text-primary uppercase">Mis horas</p>
          <h2 className="text-2xl font-light tracking-tight sm:text-3xl">{name}</h2>
          <p className="text-sm font-light text-muted-foreground">
            {department} · {formatLongDate(dayKey)}
          </p>
        </header>

        <section className="mt-7 grid gap-3 sm:grid-cols-3">
          <Stat
            icon={<Clock3 className="size-4" />}
            label="Total hoy"
            value={formatDuration(summary.todayWorked)}
            highlight
          />
          <Stat icon={<Repeat className="size-4" />} label="Turnos hoy" value={`${turnosHoy}`} />
          <Stat
            icon={<Activity className="size-4" />}
            label="Estado"
            value={summary.todayOpen ? 'En curso' : 'Fuera'}
            muted={!summary.todayOpen}
          />
        </section>

        <section className="mt-3 grid gap-3 sm:grid-cols-2">
          <Stat icon={<CalendarRange className="size-4" />} label="Esta semana" value={formatDuration(summary.week)} />
          <Stat icon={<CalendarRange className="size-4" />} label="Este mes" value={formatDuration(summary.month)} />
        </section>

        <section className="mt-3">
          <Stat
            icon={<Wallet className="size-4" />}
            label="Sueldo estimado este mes"
            value={formatCurrency(estimatedPay(summary.month, hourlyWage))}
            highlight
          />
        </section>

        <section className="mt-7">
          <h3 className="mb-3 text-xs tracking-[0.28em] text-muted-foreground uppercase">
            Últimos registros
          </h3>
          {summary.days.length === 0 ? (
            <p className="rounded-xl border border-border/70 px-4 py-8 text-center text-sm font-light text-muted-foreground">
              Todavía no tenés fichajes registrados.
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto rounded-xl border border-border/70">
              {summary.days.map((d) => (
                <li
                  key={d.day}
                  className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3 text-sm last:border-b-0"
                >
                  <span className="w-28 font-light text-muted-foreground">
                    {formatWeekday(d.day)} {formatShortDate(d.day)}
                  </span>
                  <span className="tnum font-mono text-foreground/90">
                    {formatTimeLabel(d.in)} — {d.out === null ? '· · ·' : formatTimeLabel(d.out)}
                  </span>
                  <span className="tnum w-20 text-right font-mono text-primary">
                    {d.open && d.day !== dayKey ? 'sin cerrar' : formatDuration(d.worked)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs font-light text-muted-foreground/70">
            Si ves un día sin cerrar o un horario que no corresponde, pedile al administrador que lo corrija.
          </p>
        </section>
      </div>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  highlight,
  muted,
}: {
  icon: React.ReactNode
  label: string
  value: string
  highlight?: boolean
  muted?: boolean
}) {
  return (
    <div className={`glass rounded-2xl p-4 ${highlight ? 'border-primary/45 glow-edge' : ''}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className={highlight ? 'text-primary' : ''}>{icon}</span>
        <span className="text-xs tracking-[0.18em] uppercase">{label}</span>
      </div>
      <p
        className={`tnum mt-2 font-mono text-2xl ${
          highlight ? 'text-primary' : muted ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  )
}
