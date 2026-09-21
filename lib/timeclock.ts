/**
 * Dominio puro del fichaje: tipos, formato y cálculo de horas.
 * Sin acceso a datos y sin `new Date()` implícito — todo lo que dependa de
 * "ahora" se recibe por parámetro desde `lib/tz.ts`. Así el mismo cálculo da
 * el mismo resultado en el navegador del kiosco y en el servidor.
 */

import { addDaysToKey, dayKeyToDate, startOfMonthKey, startOfWeekKey } from '@/lib/tz'

export type Employee = {
  id: string
  name: string
  department: string
  hourlyWage: number
  active: boolean
}

/** Una jornada. Los minutos son desde la medianoche del día `day`. */
export type Punch = {
  id: string
  employeeId: string
  /** YYYY-MM-DD */
  day: string
  in: number
  /** null mientras la jornada sigue abierta. Puede pasar de 1439 si cruza la medianoche. */
  out: number | null
  /** true si lo cargó o corrigió un administrador a mano */
  edited: boolean
  note: string | null
}

export type PunchKind = 'in' | 'out'

/** Bono (vendió más) o descuento (rompió algo, faltó) cargado a mano por un admin. */
export type Adjustment = {
  id: string
  employeeId: string
  /** YYYY-MM-DD */
  day: string
  kind: 'bonus' | 'deduction'
  amount: number
  note: string | null
}

export const PIN_LENGTH = 4

/** numeric(10,2) en la base: 8 dígitos enteros como máximo. */
export const MONTO_MAXIMO = 99_999_999

/* --------------------------------- formato -------------------------------- */

export function formatTime(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '--:--'
  const h = Math.floor(minutes / 60) % 24
  const m = Math.round(minutes % 60)
  return `${`${h}`.padStart(2, '0')}:${`${m}`.padStart(2, '0')}`
}

/** true si el minuto cae en el día siguiente al del registro (turno nocturno). */
export function crossesMidnight(minutes: number | null | undefined): boolean {
  return typeof minutes === 'number' && minutes >= 1440
}

/** Como formatTime, pero marcando el día siguiente: "02:00 +1". */
export function formatTimeLabel(minutes: number | null | undefined): string {
  const base = formatTime(minutes)
  return crossesMidnight(minutes) ? `${base} +1` : base
}

export function formatDuration(minutes: number): string {
  if (!minutes || minutes < 0) return '0h 00m'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}h ${`${m}`.padStart(2, '0')}m`
}

/** Horas decimales, para el CSV de liquidación: 8h 30m → "8,50". */
export function formatDecimalHours(minutes: number): string {
  return (Math.max(0, minutes) / 60).toFixed(2).replace('.', ',')
}

const CURRENCY = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatCurrency(amount: number): string {
  return CURRENCY.format(amount)
}

/** Salario estimado por las horas trabajadas, a la tarifa del empleado. */
export function estimatedPay(minutes: number, hourlyWage: number): number {
  return (Math.max(0, minutes) / 60) * hourlyWage
}

/** Bonos suman, descuentos restan: el neto que se le suma al salario por horas. */
export function netAdjustments(adjustments: Adjustment[]): number {
  return adjustments.reduce((acc, a) => acc + (a.kind === 'bonus' ? a.amount : -a.amount), 0)
}

/** Fila de sueldo estimado de un empleado, para el resumen de Historial y las exportaciones. */
export type PayrollRow = {
  employeeId: string
  minutes: number
  hourlyWage: number
  payFromHours: number
  bonus: number
  deduction: number
  total: number
}

/**
 * Sueldo estimado por empleado para un rango de fichajes y compensaciones.
 * Solo incluye empleados con algún fichaje o compensación en el rango: un
 * empleado sin actividad no aporta una fila de "$0" al resumen.
 */
export function buildPayrollSummary(
  employees: Employee[],
  punches: Punch[],
  adjustments: Adjustment[],
  dayKey: string,
  nowMin: number,
): PayrollRow[] {
  const wageById = new Map(employees.map((e) => [e.id, e.hourlyWage]))

  const minutesById = new Map<string, number>()
  for (const p of punches) {
    const worked = workedMinutes(p, nowMin, p.day === dayKey)
    minutesById.set(p.employeeId, (minutesById.get(p.employeeId) ?? 0) + worked)
  }

  const bonusById = new Map<string, number>()
  const deductionById = new Map<string, number>()
  for (const a of adjustments) {
    const map = a.kind === 'bonus' ? bonusById : deductionById
    map.set(a.employeeId, (map.get(a.employeeId) ?? 0) + a.amount)
  }

  const ids = new Set([...minutesById.keys(), ...bonusById.keys(), ...deductionById.keys()])

  return [...ids].map((employeeId) => {
    const minutes = minutesById.get(employeeId) ?? 0
    const hourlyWage = wageById.get(employeeId) ?? 0
    const bonus = bonusById.get(employeeId) ?? 0
    const deduction = deductionById.get(employeeId) ?? 0
    const payFromHours = estimatedPay(minutes, hourlyWage)
    return {
      employeeId,
      minutes,
      hourlyWage,
      payFromHours,
      bonus,
      deduction,
      total: payFromHours + bonus - deduction,
    }
  })
}

const LONG_DATE = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

const SHORT_DATE = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
})

const WEEKDAY = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' })

export function formatLongDate(day: string): string {
  const s = LONG_DATE.format(dayKeyToDate(day))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatShortDate(day: string): string {
  // es-AR devuelve "01-ago"; el guión al lado del día de la semana queda raro
  // ("Lun 24-ago"), así que lo pasamos a espacio.
  return SHORT_DATE.format(dayKeyToDate(day)).replace('-', ' ').replace('.', '')
}

export function formatWeekday(day: string): string {
  const s = WEEKDAY.format(dayKeyToDate(day)).replace('.', '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/* --------------------------------- cálculo -------------------------------- */

/**
 * Minutos trabajados en una jornada.
 * Una jornada abierta solo suma tiempo si es la de hoy: un registro sin salida
 * de hace tres días es un olvido, no diez mil horas trabajadas.
 */
export function workedMinutes(p: Punch, nowMin: number, isToday: boolean): number {
  if (p.out !== null) return Math.max(0, p.out - p.in)
  if (isToday) return Math.max(0, nowMin - p.in)
  return 0
}

/** Jornada abierta que ya no es de hoy: hay que corregirla desde el panel. */
export function isDangling(p: Punch, todayKey: string): boolean {
  return p.out === null && p.day < todayKey
}

/**
 * Duración máxima de una jornada. Más que esto no es un turno: es alguien que
 * se olvidó de fichar la salida y volvió a tocar el PIN al día siguiente —
 * cerrarlo en ese momento cargaría 24 horas que nadie trabajó.
 */
export const MAX_JORNADA_MINUTOS = 16 * 60

export type ResolucionCierre =
  /** El fichaje abierto es un olvido (de hace más de un día, o que ya pasó
   * el tope de duración): no se cierra con una hora inventada. Se deja para
   * que el admin lo corrija y este toque abre uno nuevo. */
  | { action: 'abrir' }
  | { action: 'cerrar'; minute: number }
  /** Doble toque, o alguien que se arrepiente al instante de la entrada. */
  | { action: 'muy_pronto' }
  /** Turno de hoy que ya pasó el tope: no se cierra con una duración imposible
   * ni se abre otro encima (sería un segundo fichaje abierto el mismo día). */
  | { action: 'excedido' }

/**
 * Decide qué hacer cuando alguien ficha y ya tiene un turno abierto. Puro:
 * no toca la base, solo la lógica de horario — así el cruce de medianoche
 * (entrar 23:50, salir 00:10) se puede probar sin un fichaje abierto real.
 */
export function resolverCierre(abierto: Punch, dayKey: string, minutes: number): ResolucionCierre {
  const cruzoUnaMedianoche = abierto.day !== dayKey && addDaysToKey(abierto.day, 1) === dayKey
  if (abierto.day !== dayKey && !cruzoUnaMedianoche) return { action: 'abrir' }

  const minute = cruzoUnaMedianoche ? minutes + 1440 : minutes
  if (minute <= abierto.in) return { action: 'muy_pronto' }

  if (minute - abierto.in > MAX_JORNADA_MINUTOS) {
    return cruzoUnaMedianoche ? { action: 'abrir' } : { action: 'excedido' }
  }

  return { action: 'cerrar', minute }
}

/**
 * Tramos de un empleado en un día, ordenados por hora de entrada — así el
 * turno 1 es siempre el que arrancó primero, sin importar en qué orden se
 * hayan cargado o corregido.
 */
export function tramosDelDia(punches: Punch[], day: string): Punch[] {
  return punches.filter((p) => p.day === day).sort((a, b) => a.in - b.in)
}

/** Número de turno que le toca a un fichaje nuevo: uno más que los que ya tiene ese día. */
export function proximoTurno(punches: Punch[], day: string): number {
  return tramosDelDia(punches, day).length + 1
}

export type SummaryDay = {
  day: string
  in: number
  out: number | null
  worked: number
  open: boolean
}

export type Summary = {
  /** Suma de todos los tramos de hoy (con horario cortado puede haber más de uno). */
  todayWorked: number
  /** true si algún tramo de hoy sigue sin salida. */
  todayOpen: boolean
  week: number
  month: number
  /** Uno por fichaje, no por día: los tramos de hoy también aparecen acá. */
  days: SummaryDay[]
}

export function buildSummary(punches: Punch[], todayKey: string, nowMin: number): Summary {
  const weekStart = startOfWeekKey(todayKey)
  const monthStart = startOfMonthKey(todayKey)

  let week = 0
  let month = 0
  let todayWorked = 0
  let todayOpen = false

  const days: SummaryDay[] = [...punches]
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .map((p) => {
      const isToday = p.day === todayKey
      const worked = workedMinutes(p, nowMin, isToday)
      if (p.day >= weekStart) week += worked
      if (p.day >= monthStart) month += worked
      if (isToday) {
        todayWorked += worked
        if (p.out === null) todayOpen = true
      }
      return { day: p.day, in: p.in, out: p.out, worked, open: p.out === null }
    })

  return { todayWorked, todayOpen, week, month, days: days.slice(0, 21) }
}

/* -------------------------------- validación ------------------------------- */

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)
}

/** "08:30" → 510. Acepta hasta 47:59 para turnos que cruzan la medianoche. */
export function parseTimeInput(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59 || h > 47) return null
  return h * 60 + min
}

/** 510 → "08:30". Para prellenar los inputs de corrección del panel. */
export function toTimeInput(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return ''
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${`${h}`.padStart(2, '0')}:${`${m}`.padStart(2, '0')}`
}
