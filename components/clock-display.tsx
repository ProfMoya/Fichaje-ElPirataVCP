'use client'

import { formatLongDate } from '@/lib/timeclock'
import { zonedNow } from '@/lib/tz'
import { useNow } from '@/lib/use-now'

/**
 * Reloj de la terminal. Muestra siempre la hora de Argentina, aunque la tablet
 * del kiosco tenga otro huso configurado: la hora que se ve tiene que ser la
 * misma que la que queda registrada.
 */
export function ClockDisplay() {
  const date = useNow()
  const now = date ? zonedNow(date) : null

  const hh = now ? `${now.hour}`.padStart(2, '0') : '--'
  const mm = now ? `${now.minute}`.padStart(2, '0') : '--'
  const ss = now ? `${now.second}`.padStart(2, '0') : '--'

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div
        className="text-glow tnum flex items-baseline justify-center font-mono text-[clamp(3.5rem,12vw,8.5rem)] leading-[0.9] font-medium tracking-tight text-foreground"
        aria-live="off"
      >
        <span>{hh}</span>
        <span className="mx-[0.06em] text-primary/70">:</span>
        <span>{mm}</span>
        <span className="ml-[0.12em] text-[0.42em] font-normal tracking-normal text-primary/80">{ss}</span>
      </div>
      <p className="text-pretty text-base font-light tracking-wide text-muted-foreground sm:text-xl md:text-2xl">
        {now ? formatLongDate(now.dayKey) : ' '}
      </p>
    </div>
  )
}
