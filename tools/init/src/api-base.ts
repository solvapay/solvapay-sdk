export const DEFAULT_API_BASE_URL = 'https://api.solvapay.com'
export const DEV_API_BASE_URL = 'https://api-dev.solvapay.com'

export type ApiBaseResolveOptions = {
  apiBaseUrl?: string
  dev?: boolean
}

/**
 * Validate an explicit `--api-base` value. Throws rather than falling
 * back — a typo must not silently hit production or api-dev.
 */
export const parseExplicitApiBaseUrl = (raw: string): string => {
  try {
    // `new URL` is the parseability check; we keep the original string
    // (minus a trailing slash) so localhost / IPv6 forms stay intact.
    new URL(raw)
  } catch {
    throw new Error(`Invalid --api-base URL: ${raw}`)
  }
  return raw.replace(/\/$/, '')
}

/**
 * Shared CLI precedence: `--api-base` > `--dev` > `SOLVAPAY_API_BASE_URL` > production.
 * `--dev` still beats a leaked env var so one flag keeps the api-dev story.
 */
export const resolveCliApiBaseUrl = (opts: ApiBaseResolveOptions): string => {
  if (opts.apiBaseUrl) return parseExplicitApiBaseUrl(opts.apiBaseUrl)
  if (opts.dev) return DEV_API_BASE_URL
  return (process.env.SOLVAPAY_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')
}
