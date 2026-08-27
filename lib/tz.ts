/**
 * Todo el sistema razona en hora de Argentina, sin importar dónde corra.
 *
 * Es la pieza más delicada del proyecto: el servidor de Netlify corre en UTC,
 * así que `new Date().getHours()` allá devuelve una hora que no es la del
 * local. Si un empleado ficha a las 22:30 de un martes, en UTC ya es
 * miércoles 01:30 y el fichaje se guardaría en el día equivocado. Estas
 * funciones son la única fuente de verdad sobre "qué día y qué hora es".
 */

export const TZ = 'America/Argentina/Buenos_Aires'

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export type ZonedNow = {
  /** YYYY-MM-DD en hora de Argentina */
  dayKey: string
  /** minutos desde la medianoche local (0–1439) */
  minutes: number
  hour: number
  minute: number
  second: number
}

export function zonedNow(d: Date = new Date()): ZonedNow {
  const parts: Record<string, string> = {}
  for (const p of PARTS.formatToParts(d)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }

  const hour = Number(parts.hour) % 24
  const minute = Number(parts.minute)
  const second = Number(parts.second)

  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute,
    hour,
    minute,
    second,
  }
}

/**
 * Convierte una clave YYYY-MM-DD en un Date fijado al mediodía UTC.
 *
 * El mediodía no es capricho: evita que el día se corra al formatear o
 * comparar desde runtimes en husos distintos. Estas fechas se usan solo para
 * ordenar y dar formato, nunca para calcular horas.
 */
export function dayKeyToDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

export function dateToDayKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${d.getUTCDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysToKey(day: string, days: number): string {
  const d = dayKeyToDate(day)
  d.setUTCDate(d.getUTCDate() + days)
  return dateToDayKey(d)
}

/** Lunes de la semana a la que pertenece `day`. */
export function startOfWeekKey(day: string): string {
  const d = dayKeyToDate(day)
  const dow = (d.getUTCDay() + 6) % 7 // lunes = 0
  return addDaysToKey(day, -dow)
}

/** Día 1 del mes al que pertenece `day`. */
export function startOfMonthKey(day: string): string {
  return `${day.slice(0, 7)}-01`
}

/** Valida que un string tenga forma YYYY-MM-DD y sea una fecha real. */
export function isValidDayKey(day: unknown): day is string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const d = dayKeyToDate(day)
  return !Number.isNaN(d.getTime()) && dateToDayKey(d) === day
}
