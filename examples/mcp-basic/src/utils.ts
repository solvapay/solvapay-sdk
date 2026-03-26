/**
 * Validate Origin header to prevent DNS rebinding attacks
 */
export function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin)
    return url.origin.toLowerCase()
  } catch {
    return null
  }
}

export function parseAllowedOrigins(rawAllowedOrigins?: string): string[] {
  if (!rawAllowedOrigins?.trim()) {
    return []
  }

  return rawAllowedOrigins
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0)
    .map(origin => normalizeOrigin(origin))
    .filter((origin): origin is string => origin !== null)
}

export function validateOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) {
    // Allow requests without Origin header (e.g., from same origin or curl)
    return true
  }

  const normalizedOrigin = normalizeOrigin(origin)
  if (!normalizedOrigin) {
    return false
  }

  const allowedSet = new Set(allowedOrigins.map(allowedOrigin => allowedOrigin.toLowerCase()))
  return allowedSet.has(normalizedOrigin)
}

/**
 * Create a JSON-RPC error response
 */
export function createErrorResponse(code: number, message: string) {
  return {
    jsonrpc: '2.0' as const,
    error: {
      code,
      message,
    },
    id: null,
  }
}

