/**
 * Structured SolvaPay errors. Every error carries a stable `code` plus a
 * `docsUrl` that points at the fix for the specific failure mode.
 *
 * Thrown during development to self-heal common wiring mistakes:
 * missing provider, missing env var, missing API route, missing productRef.
 */

export const DOCS_BASE_URL = 'https://solvapay.com/docs'

export type SolvaPayErrorCode =
  | 'MISSING_PROVIDER'
  | 'MISSING_ENV_VAR'
  | 'MISSING_API_ROUTE'
  | 'MISSING_PRODUCT_REF'

export class SolvaPayError extends Error {
  readonly code: SolvaPayErrorCode
  readonly docsUrl: string

  constructor(code: SolvaPayErrorCode, message: string, docsUrl: string) {
    super(message)
    this.name = 'SolvaPayError'
    this.code = code
    this.docsUrl = docsUrl
  }
}

export class MissingProviderError extends SolvaPayError {
  constructor(primitiveName: string) {
    const docsUrl = `${DOCS_BASE_URL}/troubleshooting/missing-provider`
    super(
      'MISSING_PROVIDER',
      `${primitiveName} must be rendered inside <SolvaPayProvider>. ` +
        `Wrap your app (or the section using ${primitiveName}) with <SolvaPayProvider config={{ ... }}>. ` +
        `See ${docsUrl}`,
      docsUrl,
    )
    this.name = 'MissingProviderError'
  }
}

export class MissingEnvVarError extends SolvaPayError {
  constructor(envVar: string) {
    const docsUrl = `${DOCS_BASE_URL}/setup/env-vars`
    super(
      'MISSING_ENV_VAR',
      `Required environment variable ${envVar} is not set. ` +
        `Add it to your .env and restart your dev server. See ${docsUrl}`,
      docsUrl,
    )
    this.name = 'MissingEnvVarError'
  }
}

export class MissingApiRouteError extends SolvaPayError {
  constructor(route: string) {
    const docsUrl = `${DOCS_BASE_URL}/setup/api-route`
    super(
      'MISSING_API_ROUTE',
      `SolvaPay could not reach the expected API route ${route}. ` +
        `Add a SolvaPay-compatible route handler at that path. See ${docsUrl}`,
      docsUrl,
    )
    this.name = 'MissingApiRouteError'
  }
}

export class MissingProductRefError extends SolvaPayError {
  constructor(primitiveName: string) {
    const docsUrl = `${DOCS_BASE_URL}/primitives/product-ref`
    super(
      'MISSING_PRODUCT_REF',
      `${primitiveName} requires a productRef. ` +
        `Pass the \`productRef\` prop (or set NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF). See ${docsUrl}`,
      docsUrl,
    )
    this.name = 'MissingProductRefError'
  }
}
