import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { zonedNow, startOfWeekKey, startOfMonthKey, addDaysToKey, isValidDayKey } from '@/lib/tz'
import { pickClientIp } from '@/lib/client-ip'
import {
  formatTime, formatTimeLabel, formatDuration, formatDecimalHours,
  parseTimeInput, toTimeInput, workedMinutes, buildSummary, isValidPin,
  formatShortDate, formatWeekday, formatLongDate, resolverCierre,
  tramosDelDia, proximoTurno, MAX_JORNADA_MINUTOS, type Punch,
} from '@/lib/timeclock'

let n = 0
const t = (nombre: string, fn: () => void) => { fn(); n++; console.log('  ok ·', nombre) }

console.log('\nHUSO HORARIO (Argentina = UTC-3, sin horario de verano)')
t('22:30 de Argentina no se va al día siguiente', () => {
  const z = zonedNow(new Date('2026-08-26T02:30:00Z'))
  assert.equal(z.dayKey, '2026-08-25'); assert.equal(z.minutes, 23 * 60 + 30)
})
t('medianoche UTC sigue siendo el día anterior acá', () => {
  const z = zonedNow(new Date('2026-08-26T00:00:00Z'))
  assert.equal(z.dayKey, '2026-08-25'); assert.equal(z.minutes, 21 * 60)
})
t('medianoche local da minuto 0 y no 1440 (hourCycle h23)', () => {
  const z = zonedNow(new Date('2026-08-26T03:00:00Z'))
  assert.equal(z.dayKey, '2026-08-26'); assert.equal(z.minutes, 0); assert.equal(z.hour, 0)
})
t('mediodía local', () => {
  const z = zonedNow(new Date('2026-08-26T15:00:00Z'))
  assert.equal(z.minutes, 12 * 60)
})
t('enero (verano austral) sigue siendo UTC-3', () => {
  assert.equal(zonedNow(new Date('2026-01-15T02:00:00Z')).dayKey, '2026-01-14')
})

console.log('\nCLAVES DE DÍA')
t('semana arranca el lunes', () => {
  assert.equal(startOfWeekKey('2026-08-26'), '2026-08-24') // miércoles → lunes
  assert.equal(startOfWeekKey('2026-08-24'), '2026-08-24') // lunes → sí mismo
  assert.equal(startOfWeekKey('2026-08-23'), '2026-08-17') // domingo → lunes anterior
})
t('inicio de mes', () => assert.equal(startOfMonthKey('2026-08-26'), '2026-08-01'))
t('sumar días cruza el mes', () => {
  assert.equal(addDaysToKey('2026-08-31', 1), '2026-09-01')
  assert.equal(addDaysToKey('2026-01-01', -1), '2025-12-31')
  assert.equal(addDaysToKey('2024-02-28', 1), '2024-02-29') // bisiesto
})
t('rechaza fechas que no existen', () => {
  assert.equal(isValidDayKey('2026-02-30'), false)
  assert.equal(isValidDayKey('2026-13-01'), false)
  assert.equal(isValidDayKey('26-08-01'), false)
  assert.equal(isValidDayKey('2026-08-26'), true)
})
t('formato de fecha no se corre de día', () => {
  assert.equal(formatShortDate('2026-08-01'), '01 ago')
  assert.equal(formatWeekday('2026-08-24'), 'Lun')
  assert.ok(formatLongDate('2026-08-26').startsWith('Miércoles'))
})

console.log('\nHORAS')
t('formato de hora', () => {
  assert.equal(formatTime(525), '08:45')
  assert.equal(formatTime(null), '--:--')
  assert.equal(formatTime(1530), '01:30')          // 25:30 → 01:30 del día siguiente
  assert.equal(formatTimeLabel(1530), '01:30 +1')
  assert.equal(formatTimeLabel(1050), '17:30')
})
t('duración y horas decimales', () => {
  assert.equal(formatDuration(510), '8h 30m')
  assert.equal(formatDuration(0), '0h 00m')
  assert.equal(formatDuration(-5), '0h 00m')
  assert.equal(formatDecimalHours(510), '8,50')
})
t('parseo de la hora que teclea el admin', () => {
  assert.equal(parseTimeInput('08:30'), 510)
  assert.equal(parseTimeInput('25:30'), 1530)
  assert.equal(parseTimeInput(' 9:05 '), 545)
  assert.equal(parseTimeInput('8:5'), null)
  assert.equal(parseTimeInput('08:60'), null)
  assert.equal(parseTimeInput('48:00'), null)
  assert.equal(parseTimeInput('mañana'), null)
})
t('ida y vuelta del input de hora', () => {
  assert.equal(toTimeInput(1530), '25:30')
  assert.equal(toTimeInput(null), '')
  assert.equal(parseTimeInput(toTimeInput(1530)!), 1530)
})
t('PIN válido solo con 4 dígitos', () => {
  assert.equal(isValidPin('0000'), true)
  assert.equal(isValidPin('123'), false)
  assert.equal(isValidPin('12a4'), false)
  assert.equal(isValidPin(1234 as unknown), false)
})

console.log('\nCÁLCULO DE JORNADA')
const p = (day: string, i: number, o: number | null): Punch =>
  ({ id: day, employeeId: 'e', day, in: i, out: o, edited: false, note: null })

t('jornada cerrada', () => assert.equal(workedMinutes(p('2026-08-26', 525, 1050), 700, true), 525))
t('jornada abierta de hoy corre contra el reloj', () =>
  assert.equal(workedMinutes(p('2026-08-26', 525, null), 700, true), 175))
t('jornada abierta de otro día no suma nada', () =>
  assert.equal(workedMinutes(p('2026-08-20', 525, null), 700, false), 0))
t('turno nocturno cerrado a las 25:30', () =>
  assert.equal(workedMinutes(p('2026-08-25', 1320, 1530), 700, false), 210))

t('resumen: semana y mes se suman por separado', () => {
  // Hoy: miércoles 26/08. La semana arranca el lunes 24.
  const punches = [
    p('2026-08-26', 540, null),   // hoy, abierta: 60 min hasta las 10:00
    p('2026-08-25', 540, 1020),   // martes: 480
    p('2026-08-24', 540, 1020),   // lunes: 480
    p('2026-08-21', 540, 1020),   // viernes pasado: 480 (mes sí, semana no)
    p('2026-07-31', 540, 1020),   // mes pasado: no suma en ninguno
  ]
  const s = buildSummary(punches, '2026-08-26', 600)
  assert.equal(s.todayWorked, 60)
  assert.equal(s.todayOpen, true)
  assert.equal(s.days[0].in, 540)
  assert.equal(s.week, 60 + 480 + 480)
  assert.equal(s.month, 60 + 480 + 480 + 480)
  assert.equal(s.days[0].day, '2026-08-26') // más reciente primero
})

t('resumen sin fichaje de hoy', () => {
  const s = buildSummary([p('2026-08-25', 540, 1020)], '2026-08-26', 600)
  assert.equal(s.todayOpen, false)
  assert.equal(s.todayWorked, 0)
})

t('resumen vacío no explota', () => {
  const s = buildSummary([], '2026-08-26', 600)
  assert.deepEqual([s.week, s.month, s.days.length], [0, 0, 0])
})

t('horario cortado: dos tramos el mismo día se suman en el total de hoy', () => {
  const punches = [
    p('2026-08-26', 480, 720),  // mañana: 08:00 a 12:00 = 240
    p('2026-08-26', 840, null), // tarde, abierta: 14:00 hasta las 15:00 = 60
  ]
  const s = buildSummary(punches, '2026-08-26', 900)
  assert.equal(s.todayWorked, 240 + 60)
  assert.equal(s.todayOpen, true)
  assert.equal(s.days.filter((d) => d.day === '2026-08-26').length, 2)
})

console.log('\nCIERRE DE UN TOQUE DE PIN (kiosco)')
t('cierra normal, mismo día', () => {
  const r = resolverCierre(p('2026-08-26', 480, null), '2026-08-26', 720)
  assert.deepEqual(r, { action: 'cerrar', minute: 720 })
})
t('cruza una medianoche: entra 23:50, sale 00:10 del día siguiente', () => {
  const r = resolverCierre(p('2026-08-25', 1430, null), '2026-08-26', 10)
  assert.deepEqual(r, { action: 'cerrar', minute: 1450 }) // 24h + 10m desde la entrada
})
t('doble toque en el mismo minuto no cierra una jornada de 0', () => {
  assert.deepEqual(resolverCierre(p('2026-08-26', 480, null), '2026-08-26', 480), { action: 'muy_pronto' })
})
t('doble toque cruzando la medianoche tampoco cierra en 0', () => {
  // Entra 23:59, alguien vuelve a tocar el PIN a las 23:59:30 → mismo minuto 1439, no 00:00 del otro día.
  assert.deepEqual(resolverCierre(p('2026-08-25', 1439, null), '2026-08-25', 1439), { action: 'muy_pronto' })
})
t('turno abierto hace más de un día es un olvido, no un turno en curso', () => {
  const r = resolverCierre(p('2026-08-20', 480, null), '2026-08-26', 600)
  assert.deepEqual(r, { action: 'abrir' })
})

console.log('\nTOPE DE DURACIÓN DE UNA JORNADA')
t('el tope es de 16 horas', () => {
  assert.equal(MAX_JORNADA_MINUTOS, 960)
})
t('olvidó la salida y ficha a la misma hora del día siguiente: no se cierra con 24 horas', () => {
  // Entró 10:00 del 25, vuelve a tocar 10:11 del 26 → serían 24h11m.
  const r = resolverCierre(p('2026-08-25', 600, null), '2026-08-26', 611)
  assert.deepEqual(r, { action: 'abrir' })
})
t('un turno nocturno largo pero real (justo el tope) sí se cierra', () => {
  // Entra 18:00, sale 10:00 del día siguiente = 16h exactas.
  const r = resolverCierre(p('2026-08-25', 1080, null), '2026-08-26', 600)
  assert.deepEqual(r, { action: 'cerrar', minute: 2040 })
})
t('un minuto más que el tope ya no se cierra', () => {
  const r = resolverCierre(p('2026-08-25', 1080, null), '2026-08-26', 601)
  assert.deepEqual(r, { action: 'abrir' })
})
t('turno de hoy pasado del tope: no se cierra ni se abre otro encima', () => {
  const r = resolverCierre(p('2026-08-26', 420, null), '2026-08-26', 420 + 961)
  assert.deepEqual(r, { action: 'excedido' })
})
t('turno de hoy justo en el tope se cierra normal', () => {
  const r = resolverCierre(p('2026-08-26', 420, null), '2026-08-26', 420 + 960)
  assert.deepEqual(r, { action: 'cerrar', minute: 1380 })
})

console.log('\nIP DEL CLIENTE (rate-limit)')
const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null
t('usa la IP verificada de Netlify aunque el cliente mande un x-forwarded-for falso', () => {
  const ip = pickClientIp(headers({ 'x-nf-client-connection-ip': '200.1.2.3', 'x-forwarded-for': '6.6.6.6, 200.1.2.3' }))
  assert.equal(ip, '200.1.2.3')
})
t('sin el header de Netlify toma el último salto, no el primero (que pone el cliente)', () => {
  assert.equal(pickClientIp(headers({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1, 200.1.2.3' })), '200.1.2.3')
})
t('sin ningún header cae a "local"', () => {
  assert.equal(pickClientIp(headers({})), 'local')
})

console.log('\nESQUEMA DE LA BASE (supabase/schema.sql)')
t('el índice de "un solo fichaje abierto" es por empleado y por día, nunca solo por empleado', () => {
  // Un índice solo por empleado deja sin poder fichar a quien tiene un olvido
  // viejo sin corregir (resolverCierre → 'abrir' inserta uno nuevo).
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
    .split('\n')
    .filter((linea) => !linea.trim().startsWith('--'))
    .join('\n')
  const unicos = [...sql.matchAll(/create\s+unique\s+index[^;]*?on\s+public\.punches\s*\(([^)]*)\)\s*where\s+out_min\s+is\s+null/gi)]
  assert.ok(unicos.length > 0, 'tiene que existir el índice que evita el doble toque simultáneo')
  for (const [, columnas] of unicos) {
    assert.match(columnas, /\bday\b/, `índice único sobre fichajes abiertos sin "day": (${columnas.trim()})`)
  }
})

console.log('\nNUMERACIÓN DE TURNOS (horario cortado)')
t('ordena los tramos del día por hora de entrada, no por como se cargaron', () => {
  const punches = [
    p('2026-08-26', 840, 900), // tarde, aparece primero en el array
    p('2026-08-26', 480, 720), // mañana
  ]
  assert.deepEqual(tramosDelDia(punches, '2026-08-26').map((x) => x.in), [480, 840])
})
t('el próximo turno es uno más que los que ya tiene ese día', () => {
  assert.equal(proximoTurno([], '2026-08-26'), 1)
  assert.equal(proximoTurno([p('2026-08-26', 480, 720)], '2026-08-26'), 2)
})
t('un fichaje de otro día no cuenta para el turno de hoy', () => {
  const punches = [p('2026-08-25', 480, 720)]
  assert.equal(proximoTurno(punches, '2026-08-26'), 1)
})

console.log(`\n${n} verificaciones pasaron\n`)
