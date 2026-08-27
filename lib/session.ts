import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

/**
 * Sesión del panel de administración.
 *
 * Es una cookie httpOnly firmada con HMAC: el navegador la guarda pero no la
 * puede leer por JavaScript ni modificar sin invalidar la firma. No usamos una
 * librería de JWT porque no hace falta nada de lo que aportan (algoritmos
 * negociables, claves rotativas, terceros verificando el token): acá el mismo
 * servidor firma y verifica.
 */

const COOKIE = 'elpiratavcp_session'
const MAX_AGE_SECONDS = 8 * 60 * 60 // una jornada

export type Session = {
  adminId: string
  username: string
  mustChangePassword: boolean
}

type Payload = Session & { exp: number }

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function sign(data: string): string {
  return b64url(createHmac('sha256', env.sessionSecret).update(data).digest())
}

function serialize(payload: Payload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${body}.${sign(body)}`
}

function deserialize(token: string): Payload | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null

  const body = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  const expected = sign(body)

  // Longitudes distintas ya descartan la firma; timingSafeEqual exige que coincidan.
  if (signature.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
    if (typeof payload.adminId !== 'string' || typeof payload.username !== 'string') return null
    return payload
  } catch {
    return null
  }
}

export async function createSession(session: Session): Promise<void> {
  const payload: Payload = { ...session, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS }
  const store = await cookies()
  store.set(COOKIE, serialize(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function readSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  const payload = deserialize(token)
  if (!payload) return null
  return {
    adminId: payload.adminId,
    username: payload.username,
    mustChangePassword: payload.mustChangePassword,
  }
}

export async function destroySession(): Promise<void> {
  ;(await cookies()).delete(COOKIE)
}

/**
 * Guardia para las server actions del panel. Toda acción de administración
 * empieza llamando a esto: si la sesión no es válida, no se toca la base.
 */
export async function requireSession(): Promise<Session> {
  const session = await readSession()
  if (!session) throw new UnauthorizedError()
  return session
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Tu sesión expiró. Volvé a iniciar sesión.')
    this.name = 'UnauthorizedError'
  }
}
