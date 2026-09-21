'use server'

import { DbError } from '@/lib/db'
import { rateLimit, clearRateLimit } from '@/lib/rate-limit'
import { clientIp } from '@/lib/request-ip'
import * as repo from '@/lib/repo'
import {
  isValidPin,
  parseTimeInput,
  MAX_JORNADA_MINUTOS,
  MONTO_MAXIMO,
  type Adjustment,
  type Employee,
  type Punch,
} from '@/lib/timeclock'
import { addDaysToKey, isValidDayKey, startOfMonthKey, startOfWeekKey, zonedNow } from '@/lib/tz'
import {
  createSession,
  destroySession,
  readSession,
  requireSession,
  UnauthorizedError,
} from '@/lib/session'

/**
 * Acciones del panel de administración.
 *
 * Todas empiezan por `requireSession()`: la única puerta de entrada a los
 * datos es una sesión válida, verificada en el servidor. Que el navegador
 * muestre u oculte un botón no cambia nada de lo que se puede hacer.
 */

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; message: string }

function fallo(message: string): { ok: false; message: string } {
  return { ok: false, message }
}

function exito<T>(data: T): { ok: true; data: T } {
  return { ok: true, data }
}

/** Traduce cualquier excepción a un mensaje mostrable, sin filtrar internals. */
function alFallar(error: unknown): { ok: false; message: string } {
  if (error instanceof UnauthorizedError) return fallo(error.message)
  if (error instanceof DbError) return fallo(error.message)
  console.error('[admin]', error)
  return fallo('Hubo un problema en el servidor. Probá de nuevo en unos segundos.')
}

async function ipKey(prefix: string): Promise<string> {
  return `${prefix}:${await clientIp()}`
}

/* --------------------------------- sesión --------------------------------- */

export type SessionInfo = { username: string; mustChangePassword: boolean }

export async function iniciarSesion(username: string, password: string): Promise<Result<SessionInfo>> {
  const user = username.trim()
  if (!user || !password) return fallo('Completá usuario y contraseña.')

  const key = await ipKey(`login:${user.toLowerCase()}`)
  const limit = rateLimit(key, 6, 600)
  if (!limit.ok) {
    const minutos = Math.ceil(limit.retryAfterSeconds / 60)
    return fallo(`Demasiados intentos fallidos. Probá de nuevo en ${minutos} minuto${minutos === 1 ? '' : 's'}.`)
  }

  try {
    const admin = await repo.verifyAdmin(user, password)
    if (!admin) return fallo('Usuario o contraseña incorrectos.')

    clearRateLimit(key)
    await createSession({
      adminId: admin.id,
      username: admin.username,
      mustChangePassword: admin.mustChangePassword,
    })

    return exito({ username: admin.username, mustChangePassword: admin.mustChangePassword })
  } catch (error) {
    return alFallar(error)
  }
}

export async function cerrarSesion(): Promise<void> {
  await destroySession()
}

export async function cambiarPassword(actual: string, nueva: string): Promise<Result<SessionInfo>> {
  try {
    const session = await requireSession()

    if (nueva.length < 8) return fallo('La contraseña nueva tiene que tener al menos 8 caracteres.')
    if (nueva === actual) return fallo('La contraseña nueva tiene que ser distinta de la actual.')

    const ok = await repo.changeAdminPassword(session.adminId, actual, nueva)
    if (!ok) return fallo('La contraseña actual no es correcta.')

    // La sesión guarda `mustChangePassword`: hay que reemitirla para que el
    // aviso deje de aparecer sin obligar a volver a entrar.
    await createSession({ ...session, mustChangePassword: false })
    return exito({ username: session.username, mustChangePassword: false })
  } catch (error) {
    return alFallar(error)
  }
}

export async function sesionActual(): Promise<SessionInfo | null> {
  const session = await readSession()
  return session ? { username: session.username, mustChangePassword: session.mustChangePassword } : null
}

/* ------------------------------ datos del panel ---------------------------- */

export type PanelFilter = {
  employeeId?: string
  from?: string
  to?: string
}

export type PanelData = {
  employees: Employee[]
  /** Fichajes del rango consultado (historial). */
  punches: Punch[]
  /** Compensaciones (bonos/descuentos) del mismo rango. */
  adjustments: Adjustment[]
  /** Fichajes de hoy, siempre presentes aunque el filtro apunte a otro rango. */
  today: Punch[]
  /** Jornadas abiertas de días anteriores: olvidos que hay que corregir. */
  pendientes: Punch[]
  /**
   * Fichajes y compensaciones de la semana/mes en curso, de todo el
   * personal — sin el filtro de Historial, para que el dashboard de
   * Resumen no dependa de qué haya dejado filtrado el admin ahí.
   */
  resumenGeneral: { punches: Punch[]; adjustments: Adjustment[] }
  dayKey: string
  nowMin: number
}

export async function cargarPanel(filtro: PanelFilter = {}): Promise<Result<PanelData>> {
  try {
    await requireSession()
    const { dayKey, minutes } = zonedNow()

    const from = isValidDayKey(filtro.from) ? filtro.from : addDaysToKey(dayKey, -60)
    const to = isValidDayKey(filtro.to) ? filtro.to : dayKey
    if (from > to) return fallo('La fecha "desde" no puede ser posterior a la fecha "hasta".')

    const weekStart = startOfWeekKey(dayKey)
    const monthStart = startOfMonthKey(dayKey)
    const desdeResumen = weekStart < monthStart ? weekStart : monthStart

    const [employees, punches, adjustments, today, pendientes, punchesResumen, adjustmentsResumen] =
      await Promise.all([
        repo.listEmployees(),
        repo.listPunches({ employeeId: filtro.employeeId, from, to }),
        repo.listAdjustments({ employeeId: filtro.employeeId, from, to }),
        repo.listPunches({ from: dayKey, to: dayKey }),
        repo.listDanglingPunches(dayKey),
        repo.listPunches({ from: desdeResumen, to: dayKey, limit: 5000 }),
        repo.listAdjustments({ from: desdeResumen, to: dayKey }),
      ])

    return exito({
      employees,
      punches,
      adjustments,
      today,
      pendientes,
      resumenGeneral: { punches: punchesResumen, adjustments: adjustmentsResumen },
      dayKey,
      nowMin: minutes,
    })
  } catch (error) {
    return alFallar(error)
  }
}

/* -------------------------------- empleados -------------------------------- */

function validarEmpleado(name: string, pin: string | undefined, requierePin: boolean): string | null {
  if (name.trim().length < 3) return 'El nombre tiene que tener al menos 3 caracteres.'
  if (name.trim().length > 80) return 'El nombre no puede superar los 80 caracteres.'
  if (requierePin || pin) {
    if (!isValidPin(pin)) return 'El PIN tiene que ser de exactamente 4 dígitos.'
  }
  return null
}

function validarSalario(hourlyWage: number | undefined): string | null {
  if (hourlyWage === undefined) return null
  if (!Number.isFinite(hourlyWage) || hourlyWage < 0) {
    return 'El salario por hora tiene que ser un número mayor o igual a 0.'
  }
  if (hourlyWage > MONTO_MAXIMO) {
    return `El salario por hora no puede superar $${MONTO_MAXIMO.toLocaleString('es-AR')}.`
  }
  return null
}

export type NuevoEmpleado = {
  name: string
  pin: string
  department?: string
  hourlyWage?: number
}

export async function crearEmpleado(input: NuevoEmpleado): Promise<Result<Employee>> {
  try {
    await requireSession()

    const error = validarEmpleado(input.name, input.pin, true) ?? validarSalario(input.hourlyWage)
    if (error) return fallo(error)

    const res = await repo.createEmployee({
      name: input.name.trim(),
      pin: input.pin,
      department: input.department?.trim() || 'General',
      hourlyWage: input.hourlyWage ?? 0,
    })

    return res.ok ? exito(res.employee) : fallo(res.error)
  } catch (e) {
    return alFallar(e)
  }
}

export type CambiosEmpleado = {
  name?: string
  department?: string
  hourlyWage?: number
  active?: boolean
  pin?: string
}

export async function editarEmpleado(id: string, cambios: CambiosEmpleado): Promise<Result<Employee>> {
  try {
    await requireSession()

    if (cambios.name !== undefined || cambios.pin !== undefined) {
      const error = validarEmpleado(cambios.name ?? 'sin cambios', cambios.pin, false)
      if (error) return fallo(error)
    }
    const errorSalario = validarSalario(cambios.hourlyWage)
    if (errorSalario) return fallo(errorSalario)

    const res = await repo.updateEmployee(id, {
      ...cambios,
      name: cambios.name?.trim(),
      department: cambios.department?.trim(),
    })

    return res.ok ? exito(res.employee) : fallo(res.error)
  } catch (e) {
    return alFallar(e)
  }
}

export async function eliminarEmpleado(id: string): Promise<Result> {
  try {
    await requireSession()
    await repo.deleteEmployee(id)
    return exito(undefined)
  } catch (e) {
    return alFallar(e)
  }
}

/* --------------------------- fichajes (corrección) -------------------------- */

export type FichajeManual = {
  /** Si viene, corrige ese fichaje puntual; si no, carga un turno nuevo. */
  id?: string
  employeeId: string
  day: string
  /** "08:30" */
  entrada: string
  /** "17:00", o vacío para dejar la jornada abierta */
  salida: string
  nota?: string
}

/** true si los rangos [aIn, aOut) y [bIn, bOut) se superponen. Un `out` abierto se trata como sin límite: un turno en curso "tapa" cualquier otro que empiece después. */
function seSuperponen(aIn: number, aOut: number | null, bIn: number, bOut: number | null): boolean {
  const finA = aOut ?? Infinity
  const finB = bOut ?? Infinity
  return aIn < finB && bIn < finA
}

export async function guardarFichaje(input: FichajeManual): Promise<Result<Punch>> {
  try {
    await requireSession()
    const { dayKey } = zonedNow()

    if (!input.employeeId) return fallo('Elegí a qué empleado corresponde el fichaje.')
    if (!isValidDayKey(input.day)) return fallo('La fecha no es válida.')
    if (input.day > dayKey) return fallo('No se pueden cargar fichajes con fecha futura.')

    const entrada = parseTimeInput(input.entrada)
    if (entrada === null) return fallo('La hora de entrada no es válida. Usá el formato HH:MM, por ejemplo 08:30.')
    if (entrada > 1439) return fallo('La hora de entrada tiene que estar entre 00:00 y 23:59.')

    let salida: number | null = null
    if (input.salida.trim() !== '') {
      salida = parseTimeInput(input.salida)
      if (salida === null) return fallo('La hora de salida no es válida. Usá el formato HH:MM, por ejemplo 17:00.')
      if (salida <= entrada) {
        return fallo(
          'La salida tiene que ser posterior a la entrada. Si el turno termina al día siguiente, cargala como 25:30 para las 01:30.',
        )
      }
      if (salida > 2879) return fallo('La salida no puede superar las 47:59.')
      if (salida - entrada > MAX_JORNADA_MINUTOS) {
        return fallo(
          `Una jornada no puede durar más de ${MAX_JORNADA_MINUTOS / 60} horas. Si trabajó en dos turnos, cargalos como fichajes separados.`,
        )
      }
    }

    const delDia = await repo.listPunches({ employeeId: input.employeeId, from: input.day, to: input.day })
    const solapa = delDia.some((p) => p.id !== input.id && p.day === input.day && seSuperponen(entrada, salida, p.in, p.out))
    if (solapa) {
      return fallo('Ese horario se superpone con otro fichaje que ya tiene este empleado ese día.')
    }

    const punch = await repo.saveManualPunch({
      id: input.id,
      employeeId: input.employeeId,
      day: input.day,
      in: entrada,
      out: salida,
      note: input.nota?.trim() || null,
    })

    return exito(punch)
  } catch (e) {
    return alFallar(e)
  }
}

export async function eliminarFichaje(id: string): Promise<Result> {
  try {
    await requireSession()
    await repo.deletePunch(id)
    return exito(undefined)
  } catch (e) {
    return alFallar(e)
  }
}

/* ------------------------------ compensaciones ------------------------------ */

export type NuevaCompensacion = {
  employeeId: string
  day: string
  kind: 'bonus' | 'deduction'
  amount: number
  nota?: string
}

export async function crearAjuste(input: NuevaCompensacion): Promise<Result<Adjustment>> {
  try {
    await requireSession()
    const { dayKey } = zonedNow()

    if (!input.employeeId) return fallo('Elegí a qué empleado corresponde la compensación.')
    if (!isValidDayKey(input.day)) return fallo('La fecha no es válida.')
    if (input.day > dayKey) return fallo('No se pueden cargar compensaciones con fecha futura.')
    if (input.kind !== 'bonus' && input.kind !== 'deduction') return fallo('El tipo de compensación no es válido.')
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return fallo('El monto tiene que ser un número mayor a 0.')
    }
    if (input.amount > MONTO_MAXIMO) {
      return fallo(`El monto no puede superar $${MONTO_MAXIMO.toLocaleString('es-AR')}.`)
    }

    const adjustment = await repo.createAdjustment({
      employeeId: input.employeeId,
      day: input.day,
      kind: input.kind,
      amount: input.amount,
      note: input.nota?.trim() || null,
    })

    return exito(adjustment)
  } catch (e) {
    return alFallar(e)
  }
}

export async function eliminarAjuste(id: string): Promise<Result> {
  try {
    await requireSession()
    await repo.deleteAdjustment(id)
    return exito(undefined)
  } catch (e) {
    return alFallar(e)
  }
}

/* -------------------------------- cierre de mes ----------------------------- */

export type CierreMes = {
  month: string
  dayKey: string
  nowMin: number
  employees: Employee[]
  punches: Punch[]
  adjustments: Adjustment[]
}

// Tope de fichajes que se pueden exportar con garantías en un solo cierre.
// Si un mes lo supera, el archivo descargado sería un recorte silencioso de
// lo que en realidad había — y el borrado de la base no respeta ese mismo
// tope, así que se perderían registros que nunca llegaron al archivo.
// Mejor abortar el cierre entero (sin borrar nada) que arriesgar eso.
const LIMITE_CIERRE_MES = 10_000

/**
 * Descarga todo lo del mes en curso (hasta hoy) y lo borra de la base.
 *
 * Devuelve los datos que acaba de borrar en la misma respuesta: así el panel
 * puede armar el archivo de descarga sin depender de una segunda lectura, y
 * el admin no pierde nada aunque la descarga en el navegador falle.
 */
export async function cerrarMes(): Promise<Result<CierreMes>> {
  try {
    await requireSession()
    const { dayKey, minutes } = zonedNow()
    const from = startOfMonthKey(dayKey)
    const to = dayKey

    const [employees, punches, adjustments] = await Promise.all([
      repo.listEmployees(),
      repo.listPunches({ from, to, limit: LIMITE_CIERRE_MES + 1 }),
      repo.listAdjustments({ from, to }),
    ])

    if (punches.length > LIMITE_CIERRE_MES) {
      return fallo(
        `Este mes tiene más de ${LIMITE_CIERRE_MES.toLocaleString('es-AR')} fichajes — son demasiados para cerrar de una sola vez sin arriesgar que el archivo descargado quede incompleto. No se borró nada; contactá a soporte para cerrarlo en partes.`,
      )
    }

    // Cerrar el mes con alguien todavía sin fichar la salida deja ese
    // fichaje afuera de los totales para siempre: mejor frenar acá que
    // archivar un mes que ya se sabe incompleto.
    const enCurso = punches.filter((p) => p.out === null)
    if (enCurso.length > 0) {
      const nombrePorId = new Map(employees.map((e) => [e.id, e.name]))
      const nombres = [...new Set(enCurso.map((p) => nombrePorId.get(p.employeeId) ?? 'un empleado eliminado'))]
      const listado = nombres.length <= 3 ? nombres.join(', ') : `${nombres.slice(0, 3).join(', ')} y ${nombres.length - 3} más`
      return fallo(
        `No se puede cerrar el mes: todavía hay fichajes sin hora de salida (${listado}). Corregilos desde Historial antes de intentar de nuevo.`,
      )
    }

    await Promise.all([repo.deletePunchesInRange(from, to), repo.deleteAdjustmentsInRange(from, to)])

    return exito({ month: dayKey.slice(0, 7), dayKey, nowMin: minutes, employees, punches, adjustments })
  } catch (e) {
    return alFallar(e)
  }
}
