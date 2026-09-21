/**
 * Elige la IP del cliente para las claves de rate-limit. `x-forwarded-for`
 * puede traer como primer valor uno que pone el propio cliente (no el borde),
 * así que confiar en el primero deja falsificar la clave y resetear el
 * contador en cada intento. Netlify agrega `x-nf-client-connection-ip` en su
 * borde con la IP real verificada — se usa esa si está; si no (dev local u
 * otro hosting), se toma el último salto de `x-forwarded-for`.
 */
export function pickClientIp(getHeader: (name: string) => string | null): string {
  const trusted = getHeader('x-nf-client-connection-ip')?.trim()
  if (trusted) return trusted

  const hops = (getHeader('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return hops.length > 0 ? hops[hops.length - 1] : 'local'
}
