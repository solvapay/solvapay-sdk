/**
 * Enrich DCR (dynamic client registration) upstream failures with a
 * diagnostic that names the likely cause. Costs nothing — the request
 * already failed; we only log.
 *
 * Platform 400 bodies that say "Invalid identifier" mean the product_ref
 * did not resolve to a provider, not that the DCR JSON was malformed.
 */

export type DcrFailureDiagnosticInput = {
  productRef: string
  apiBaseUrl: string
  status: number
  bodyText?: string
}

export function logDcrFailureDiagnostic(input: DcrFailureDiagnosticInput): void {
  const body = input.bodyText ?? ''
  const looksLikeUnresolvedProduct =
    /invalid identifier/i.test(body) ||
    (/product_ref/i.test(body) && /mcp_server_id/i.test(body))

  const hint = looksLikeUnresolvedProduct
    ? 'The platform could not resolve this productRef (often a wrong/missing product or API base URL mismatch). ' +
      'A 400 "Invalid identifier" here means the product did not resolve — not that the DCR body was malformed. ' +
      'Run `npx solvapay doctor` or check SOLVAPAY_PRODUCT_REF / SOLVAPAY_API_BASE_URL.'
    : 'Upstream DCR rejected the registration. Check SOLVAPAY_PRODUCT_REF and SOLVAPAY_API_BASE_URL ' +
      '(or run `npx solvapay doctor`).'

  console.warn(
    `[solvapay] OAuth DCR failed (${input.status}) productRef=${input.productRef} ` +
      `apiBaseUrl=${input.apiBaseUrl}. ${hint}`,
  )
}
