import 'server-only'

import { headers } from 'next/headers'

/**
 * IP del cliente para las claves de rate-limit. `x-forwarded-for` puede
 * incluir un primer valor que pone el propio cliente (no el borde), así que
 * confiar en el primero deja falsificar la clave y resetear el contador en
 * cada intento. Netlify agrega `x-nf-client-connection-ip` en su borde con la
 * IP real verificada — se usa esa si está; si no (dev local u otro hosting),
 * se toma el último salto de `x-forwarded-for`.
 */
export async function clientIp(): Promise<string> {
  const h = await headers()
  const trusted = h.get('x-nf-client-connection-ip')
  if (trusted) return trusted.trim()

  const forwarded = h.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',').map((s) => s.trim()).filter(Boolean)
    if (hops.length > 0) return hops[hops.length - 1]
  }

  return 'local'
}
