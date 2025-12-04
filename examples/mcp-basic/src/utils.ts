/**
 * Validate Origin header to prevent DNS rebinding attacks
 */
export function validateOrigin(origin: string | undefined, host: string): boolean {
  if (!origin) {
    // Allow requests without Origin header (e.g., from same origin or curl)
    return true
  }

  try {
    const originUrl = new URL(origin)
    // For localhost, allow localhost and 127.0.0.1
    if (host === 'localhost' || host === '127.0.0.1') {
      return (
        originUrl.hostname === 'localhost' ||
        originUrl.hostname === '127.0.0.1' ||
        originUrl.hostname === '[::1]'
      )
    }
    // For production, validate against allowed origins
    // You should configure this based on your deployment
    return originUrl.hostname === host
  } catch {
    return false
  }
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

