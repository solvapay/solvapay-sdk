/**
 * Enrich DCR (dynamic client registration) upstream failures with a
 * diagnostic that names the likely cause. Costs nothing — the request
 * already failed; we only log.
 *
 * Platform 400 bodies that say "Invalid identifier" mean the product_ref
 * did not resolve to a provider, not that the DCR JSON was malformed.
 */

import { callMcpSyncOp } from './native-mcp'

export type DcrFailureDiagnosticInput = {
  productRef: string
  apiBaseUrl: string
  status: number
  bodyText?: string
}

export function logDcrFailureDiagnostic(input: DcrFailureDiagnosticInput): void {
  const result = callMcpSyncOp<{ message: string }>('mcpDcrDiagnostics', {
    productRef: input.productRef,
    apiBaseUrl: input.apiBaseUrl,
    status: input.status,
    bodyText: input.bodyText ?? '',
  })
  console.warn(result.message)
}
