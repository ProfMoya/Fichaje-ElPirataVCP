import 'server-only'

/**
 * Freno básico contra fuerza bruta sobre el PIN y la contraseña de admin.
 *
 * Vive en memoria del proceso. En Netlify eso significa que cada instancia
 * lleva su propia cuenta y que el contador se pierde cuando la función se
 * recicla: frena el goteo de intentos automatizados, no a un atacante
 * decidido. Si el sistema pasa a manejar datos sensibles conviene mover esto
 * a una tabla de Supabase o a un Redis.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number }

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
    if (buckets.size > 5_000) sweep(now)
    return { ok: true }
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) }
  }

  bucket.count += 1
  return { ok: true }
}

export function clearRateLimit(key: string): void {
  buckets.delete(key)
}

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}
