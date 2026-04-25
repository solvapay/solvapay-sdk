import type { ErrorResult } from '@solvapay/server'
import { getCorsHeaders } from './cors'

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  })
}

export function errorResponse(result: ErrorResult, req?: Request): Response {
  const corsHeaders = req ? getCorsHeaders(req) : {}
  return new Response(
    JSON.stringify({ error: result.error, ...(result.details ? { details: result.details } : {}) }),
    {
      status: result.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    },
  )
}

export function jsonResponseWithCors(data: unknown, req: Request, status = 200): Response {
  const corsHeaders = getCorsHeaders(req)
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  })
}
