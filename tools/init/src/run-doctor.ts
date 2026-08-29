import chalk from 'chalk'
import { evaluateProductReadiness, SOLVAPAY_PRODUCT_REF_PLACEHOLDER } from '@solvapay/core'
import { verifyProductRef, verifySecretKey } from './browser-auth'
import {
  readSolvaPayApiBaseUrlFromEnv,
  readSolvaPayProductRefFromEnv,
  readSolvaPaySecretKeyFromEnv,
} from './env'

const DEFAULT_API_BASE_URL = 'https://api.solvapay.com'
const DEV_API_BASE_URL = 'https://api-dev.solvapay.com'

export type DoctorCommandOptions = {
  /** Target api-dev.solvapay.com (same as `solvapay init --dev`). */
  dev?: boolean
}

export type RunDoctorInDirectoryOptions = {
  cwd: string
  options?: DoctorCommandOptions
}

export type DoctorCheckResult = {
  name: string
  ok: boolean
  detail: string
}

export type DoctorReport = {
  ok: boolean
  checks: DoctorCheckResult[]
  apiBaseUrl: string
}

const preferEnv = (
  processValue: string | undefined,
  fileValue: string | undefined,
): string | undefined => {
  if (typeof processValue === 'string' && processValue.trim().length > 0) {
    return processValue.trim()
  }
  if (typeof fileValue === 'string' && fileValue.trim().length > 0) {
    return fileValue.trim()
  }
  return undefined
}

const resolveApiBaseUrl = async (cwd: string, opts: DoctorCommandOptions): Promise<string> => {
  if (opts.dev) return DEV_API_BASE_URL
  const fromFile = await readSolvaPayApiBaseUrlFromEnv(cwd)
  const resolved = preferEnv(process.env.SOLVAPAY_API_BASE_URL, fromFile)
  return (resolved || DEFAULT_API_BASE_URL).replace(/\/$/, '')
}

const printCheck = (check: DoctorCheckResult): void => {
  const mark = check.ok ? chalk.green('✓') : chalk.red('✗')
  process.stdout.write(`${mark} ${check.name}: ${check.detail}\n`)
}

/**
 * Diagnose SolvaPay credentials + product readiness for the current project.
 * Exits non-zero (via `report.ok === false`) when any hard check fails so it
 * can gate CI / pre-deploy.
 */
export const runDoctorInDirectory = async ({
  cwd,
  options = {},
}: RunDoctorInDirectoryOptions): Promise<DoctorReport> => {
  const checks: DoctorCheckResult[] = []
  const apiBaseUrl = await resolveApiBaseUrl(cwd, options)

  process.stdout.write(`\nSolvaPay doctor — ${apiBaseUrl}\n\n`)

  const secretFromFile = await readSolvaPaySecretKeyFromEnv(cwd)
  const secretKey = preferEnv(process.env.SOLVAPAY_SECRET_KEY, secretFromFile)

  if (!secretKey) {
    checks.push({
      name: 'SOLVAPAY_SECRET_KEY',
      ok: false,
      detail: 'missing (set via `npx solvapay init` or your environment)',
    })
  } else {
    const verified = await verifySecretKey(apiBaseUrl, secretKey)
    checks.push({
      name: 'SOLVAPAY_SECRET_KEY',
      ok: verified.ok,
      detail: verified.ok ? 'accepted by the API' : (verified.warning ?? 'rejected by the API'),
    })
  }

  checks.push({
    name: 'SOLVAPAY_API_BASE_URL',
    ok: true,
    detail: apiBaseUrl,
  })

  // Reachability: if the secret check already talked to the API successfully,
  // the base URL is reachable. If we have no key, probe with a cheap GET.
  if (!secretKey) {
    try {
      const response = await fetch(`${apiBaseUrl}/v1/sdk/products`, { method: 'GET' })
      checks.push({
        name: 'API reachability',
        ok: response.status !== 0,
        detail:
          response.status === 401 || response.status === 403
            ? `reachable (HTTP ${response.status} without a key — expected)`
            : `HTTP ${response.status}`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error'
      checks.push({
        name: 'API reachability',
        ok: false,
        detail: message,
      })
    }
  }

  const productRefFromFile = await readSolvaPayProductRefFromEnv(cwd)
  const productRef = preferEnv(process.env.SOLVAPAY_PRODUCT_REF, productRefFromFile)

  if (!productRef) {
    checks.push({
      name: 'SOLVAPAY_PRODUCT_REF',
      ok: false,
      detail: 'missing',
    })
  } else if (productRef === SOLVAPAY_PRODUCT_REF_PLACEHOLDER) {
    checks.push({
      name: 'SOLVAPAY_PRODUCT_REF',
      ok: false,
      detail: `still the scaffolder placeholder "${SOLVAPAY_PRODUCT_REF_PLACEHOLDER}"`,
    })
  } else if (!secretKey) {
    checks.push({
      name: 'SOLVAPAY_PRODUCT_REF',
      ok: false,
      detail: `set to "${productRef}" but cannot verify without SOLVAPAY_SECRET_KEY`,
    })
  } else {
    const verified = await verifyProductRef(apiBaseUrl, secretKey, productRef)
    if (verified.status === 'ok') {
      const readiness = evaluateProductReadiness(verified.product)
      checks.push({
        name: 'SOLVAPAY_PRODUCT_REF',
        ok: true,
        detail: `exists — "${verified.product.name}" (${verified.product.status})`,
      })
      checks.push({
        name: 'Product readiness',
        ok: readiness.ready,
        detail: readiness.ready
          ? `${readiness.activePlans}/${readiness.totalPlans} active plan(s)`
          : readiness.issues.join('; '),
      })
    } else if (verified.status === 'not_found') {
      checks.push({
        name: 'SOLVAPAY_PRODUCT_REF',
        ok: false,
        detail: `"${productRef}" not found on ${apiBaseUrl}`,
      })
    } else if (verified.status === 'invalid_placeholder') {
      checks.push({
        name: 'SOLVAPAY_PRODUCT_REF',
        ok: false,
        detail: `still the scaffolder placeholder`,
      })
    } else {
      checks.push({
        name: 'SOLVAPAY_PRODUCT_REF',
        ok: false,
        detail: verified.status === 'error' ? verified.message : 'could not verify',
      })
    }
  }

  const debugRaw = process.env.SOLVAPAY_DEBUG
  checks.push({
    name: 'SOLVAPAY_DEBUG defaults',
    ok: true,
    detail:
      debugRaw === undefined
        ? 'warning: unset — factory treats debug as ON (!== "false") while client/paywall treat it as OFF (=== "true"). Set explicitly to "true" or "false".'
        : `set to "${debugRaw}"`,
  })

  for (const check of checks) {
    printCheck(check)
  }

  const ok = checks.every(check => check.ok)
  process.stdout.write(
    ok
      ? `\n${chalk.green('All checks passed.')}\n`
      : `\n${chalk.red('Doctor found problems. Fix the ✗ items above, then re-run.')}\n`,
  )

  return { ok, checks, apiBaseUrl }
}
