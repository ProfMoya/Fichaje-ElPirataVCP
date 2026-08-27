'use server'

import { headers } from 'next/headers'
import { DbError } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import {
  closePunch,
  findEmployeeByPin,
  getOpenPunch,
  listPunchesByEmployee,
  openPunch,
} from '@/lib/repo'
import { buildSummary, isValidPin, formatTime, workedMinutes, type Summary } from '@/lib/timeclock'
import { addDaysToKey, startOfMonthKey, zonedNow } from '@/lib/tz'

/**
 * Acciones del kiosco de fichaje.
 *
 * Corren en el servidor: el PIN viaja en la petición pero nunca se guarda, y
 * el navegador jamás recibe la lista de empleados ni sus PIN. Cada resultado
 * lleva un `code` para que la interfaz pueda decidir qué mostrar, y un
 * `message` ya redactado para la persona parada frente a la terminal.
 */

export type PunchOutcome =
  | {
      ok: true
      kind: 'in' | 'out'
      name: string
      minute: number
      workedToday: number
    }
  | {
      ok: false
      code: 'formato' | 'desconocido' | 'inactivo' | 'muy_pronto' | 'saturado' | 'servidor'
      message: string
    }

async function clientKey(prefix: string): Promise<string> {
  const h = await headers()
  const ip = (h.get('x-nf-client-connection-ip') ?? h.get('x-forwarded-for') ?? 'local')
    .split(',')[0]
    .trim()
  return `${prefix}:${ip}`
}

export async function registrarFichaje(pin: string): Promise<PunchOutcome> {
  if (!isValidPin(pin)) {
    return { ok: false, code: 'formato', message: 'El PIN tiene que ser de 4 dígitos.' }
  }

  try {
    const employee = await findEmployeeByPin(pin)

    if (!employee) {
      // Solo los intentos fallidos consumen cupo: en una terminal compartida
      // todo el turno sale por la misma IP, y limitar los fichajes válidos
      // dejaría a la mitad del personal sin poder fichar a las 8 de la mañana.
      const limit = rateLimit(await clientKey('pin'), 15, 300)
      if (!limit.ok) {
        return {
          ok: false,
          code: 'saturado',
          message: `Demasiados intentos fallidos. Esperá ${limit.retryAfterSeconds} segundos o avisale al administrador.`,
        }
      }
      return {
        ok: false,
        code: 'desconocido',
        message: 'Ese PIN no corresponde a ningún empleado. Revisalo e intentá de nuevo.',
      }
    }

    if (!employee.active) {
      return {
        ok: false,
        code: 'inactivo',
        message: `${employee.name.split(' ')[0]}, tu legajo figura dado de baja. Hablá con administración.`,
      }
    }

    const { dayKey, minutes } = zonedNow()
    const abierto = await getOpenPunch(employee.id, dayKey)

    // Sin fichaje abierto, este toque abre uno nuevo — sin importar cuántos
    // pares entrada/salida ya se cerraron hoy: el horario cortado ficha
    // varias veces por día.
    if (!abierto) {
      await openPunch(employee.id, dayKey, minutes)
      return { ok: true, kind: 'in', name: employee.name, minute: minutes, workedToday: 0 }
    }

    // Doble toque en el teclado, o alguien que ficha la entrada y se
    // arrepiente al instante: sin este freno quedaría una jornada de 0 minutos.
    if (minutes <= abierto.in) {
      return {
        ok: false,
        code: 'muy_pronto',
        message: `Recién registraste tu entrada a las ${formatTime(abierto.in)}. Esperá un minuto antes de fichar la salida.`,
      }
    }

    await closePunch(abierto.id, minutes)

    // El total de hoy suma todos los tramos del día, no solo el que se
    // acaba de cerrar.
    const deHoy = await listPunchesByEmployee(employee.id, dayKey)
    const workedToday = deHoy.reduce((acc, p) => acc + workedMinutes(p, minutes, true), 0)

    return { ok: true, kind: 'out', name: employee.name, minute: minutes, workedToday }
  } catch (error) {
    return { ok: false, code: 'servidor', message: serverMessage(error) }
  }
}

export type SummaryOutcome =
  | { ok: true; name: string; department: string; hourlyWage: number; summary: Summary; dayKey: string }
  | { ok: false; code: 'formato' | 'desconocido' | 'inactivo' | 'saturado' | 'servidor'; message: string }

export async function consultarHoras(pin: string): Promise<SummaryOutcome> {
  if (!isValidPin(pin)) {
    return { ok: false, code: 'formato', message: 'El PIN tiene que ser de 4 dígitos.' }
  }

  try {
    const employee = await findEmployeeByPin(pin)

    if (!employee) {
      const limit = rateLimit(await clientKey('pin'), 15, 300)
      if (!limit.ok) {
        return {
          ok: false,
          code: 'saturado',
          message: `Demasiados intentos fallidos. Esperá ${limit.retryAfterSeconds} segundos.`,
        }
      }
      return {
        ok: false,
        code: 'desconocido',
        message: 'Ese PIN no corresponde a ningún empleado. Revisalo e intentá de nuevo.',
      }
    }

    if (!employee.active) {
      return {
        ok: false,
        code: 'inactivo',
        message: 'Tu legajo figura dado de baja. Hablá con administración.',
      }
    }

    const { dayKey, minutes } = zonedNow()

    // Desde el principio del mes o los últimos 35 días, lo que abarque más:
    // así el resumen mensual siempre está completo, incluso un día 1.
    const monthStart = startOfMonthKey(dayKey)
    const fiveWeeksAgo = addDaysToKey(dayKey, -35)
    const from = monthStart < fiveWeeksAgo ? monthStart : fiveWeeksAgo

    const punches = await listPunchesByEmployee(employee.id, from)

    return {
      ok: true,
      name: employee.name,
      department: employee.department,
      hourlyWage: employee.hourlyWage,
      dayKey,
      summary: buildSummary(punches, dayKey, minutes),
    }
  } catch (error) {
    return { ok: false, code: 'servidor', message: serverMessage(error) }
  }
}

function serverMessage(error: unknown): string {
  if (error instanceof DbError) return error.message
  console.error('[kiosco]', error)
  return 'No pudimos conectar con el servidor. Probá de nuevo en unos segundos.'
}
