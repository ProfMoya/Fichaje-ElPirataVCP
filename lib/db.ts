import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

/**
 * Cliente de Supabase con service role key.
 *
 * Saltea RLS, así que NUNCA puede llegar al navegador. El `import 'server-only'`
 * hace que el build falle si algún componente cliente importa este archivo por
 * error, en vez de descubrirlo en producción con las claves ya publicadas.
 *
 * Las tablas tienen RLS activo y ninguna política, así que este cliente es la
 * única vía de acceso a los datos: toda lectura y escritura pasa por una
 * server action donde podemos validar quién pide qué.
 */

let client: SupabaseClient | null = null

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'fichaje-maga' } },
    })
  }
  return client
}

/** Error de base de datos con un mensaje que se le puede mostrar a una persona. */
export class DbError extends Error {
  readonly detalle: unknown

  constructor(message: string, detalle?: unknown) {
    super(message)
    this.name = 'DbError'
    this.detalle = detalle
  }
}
