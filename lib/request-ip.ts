import 'server-only'

import { headers } from 'next/headers'
import { pickClientIp } from '@/lib/client-ip'

export async function clientIp(): Promise<string> {
  const h = await headers()
  return pickClientIp((name) => h.get(name))
}
