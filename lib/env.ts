import 'server-only'

/**
 * Variables de entorno del servidor.
 *
 * Se leen de forma perezosa y con un mensaje claro cuando falta alguna: un
 * deploy mal configurado tiene que fallar diciendo *qué* falta, no con un
 * "undefined is not a function" tres capas más abajo.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(
      `Falta la variable de entorno ${name}. ` +
        `Cargala en .env.local para desarrollo y en Vercel › Project Settings › Environment Variables para producción.`,
    )
  }
  return value.trim()
}

export const env = {
  get supabaseUrl() {
    return required('SUPABASE_URL')
  },
  get supabaseServiceKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY')
  },
  get pinPepper() {
    const v = required('PIN_PEPPER')
    if (v.length < 32) {
      throw new Error('PIN_PEPPER tiene que tener al menos 32 caracteres. Generá uno con: openssl rand -hex 32')
    }
    return v
  },
  get sessionSecret() {
    const v = required('SESSION_SECRET')
    if (v.length < 32) {
      throw new Error('SESSION_SECRET tiene que tener al menos 32 caracteres. Generá uno con: openssl rand -hex 32')
    }
    return v
  },
}
