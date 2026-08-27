import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'

/**
 * Los PIN no se guardan nunca en claro.
 *
 * Se guarda un HMAC-SHA256 con una clave secreta del servidor (PIN_PEPPER).
 * Elegimos HMAC y no bcrypt por una razón concreta: el kiosco necesita buscar
 * al empleado *a partir del PIN*. Con bcrypt cada empleado tiene su propia
 * sal, así que habría que recorrer toda la tabla probando uno por uno. Con
 * HMAC el digest es determinístico: una búsqueda por índice único, y de paso
 * la base puede garantizar que no haya dos empleados con el mismo PIN.
 *
 * El precio es que PIN_PEPPER no se puede rotar sin invalidar todos los PIN.
 * Si alguna vez hay que rotarla, hay que reasignar los PIN desde el panel.
 */

export function hashPin(pin: string): string {
  return createHmac('sha256', env.pinPepper).update(pin, 'utf8').digest('hex')
}

/** Comparación en tiempo constante, para no filtrar información por el tiempo de respuesta. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
