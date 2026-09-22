interface CorsConfig {
  origins: string[]
}

let corsConfig: CorsConfig = { origins: ['*'] }

export function configureCors(config: CorsConfig): void {
  corsConfig = config
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-solvapay-customer-ref',
    'Access-Control-Max-Age': '86400',
  }

  if (corsConfig.origins.includes('*')) {
    headers['Access-Control-Allow-Origin'] = '*'
  } else if (origin && corsConfig.origins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Vary'] = 'Origin'
  }

  return headers
}

export function handleCors(req: Request): Response | null {
  if (req.method !== 'OPTIONS') {
    return null
  }

  const headers = getCorsHeaders(req)

  return new Response(null, {
    status: 204,
    headers,
  })
}
