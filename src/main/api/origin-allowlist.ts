import { normalizeHttpOrigin } from '../../common/security/urlGuards'

export interface ResolveAllowedOriginsOptions {
  allowLoopbackHttp: boolean
  isDevelopment: boolean
  env: NodeJS.ProcessEnv
  log: {
    warn: (message: string, meta?: Record<string, unknown>) => void
  }
}

function sanitizeOrigin(
  origin: string,
  { allowLoopbackHttp }: { allowLoopbackHttp: boolean }
): string | null {
  try {
    return normalizeHttpOrigin(origin, { allowLoopbackHttp })
  } catch {
    return null
  }
}

export function resolveAllowedOrigins({
  allowLoopbackHttp,
  isDevelopment,
  env,
  log
}: ResolveAllowedOriginsOptions): string[] {
  const configuredOrigins = new Set<string>()
  const envOrigins = env.ALLOWED_ORIGINS
  if (envOrigins) {
    envOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0 && origin !== '*')
      .forEach((origin) => {
        const sanitized = sanitizeOrigin(origin, { allowLoopbackHttp })
        if (sanitized) {
          configuredOrigins.add(sanitized)
        } else {
          log.warn('Ignoring invalid origin in ALLOWED_ORIGINS', { origin })
        }
      })
  }

  const rendererUrl = env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    const sanitizedRenderer = sanitizeOrigin(rendererUrl, { allowLoopbackHttp })
    if (sanitizedRenderer) {
      configuredOrigins.add(sanitizedRenderer)
    } else {
      log.warn('Ignoring invalid ELECTRON_RENDERER_URL for allowed origins', {
        rendererUrl
      })
    }
  }

  if (isDevelopment) {
    configuredOrigins.add('http://localhost:5173')
    configuredOrigins.add('http://127.0.0.1:5173')
    configuredOrigins.add('http://[::1]:5173')
  }

  return Array.from(configuredOrigins)
}
