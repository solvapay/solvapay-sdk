import chalk from 'chalk'
import {
  evaluateProductReadiness,
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER,
} from '@solvapay/core'
import { verifyProductRef, verifySecretKey } from './browser-auth'
import {
  readSolvaPayApiBaseUrlFromEnv,
  readSolvaPayProductRefFromEnv,
  readSolvaPaySecretKeyFromEnv,
} from './env'
import { findLanguageMarkers } from './language'
import { detectPackageManager } from './project'
import {
  describeLegacyImports,
  inspectPythonMcpProject,
  majorVersion,
  MCP_MIGRATION_GUIDE,
  PYTHON_MCP_GUIDE,
} from './python-mcp'
import {
  fetchDistTags,
  findOutdatedSolvapayPackages,
  installedGoSdk,
  installedPythonSdk,
  languageUpgradeCommand,
  solvapayDependencies,
  upgradeCommand,
  type FetchDistTags,
  type InstalledSdk,
} from './sdk-versions'
import {
  compareSdkVersions,
  fetchSdkVersions,
  isSdkPreview,
  newestAny,
  newestStable,
  type SdkLanguage,
} from './sdk-registry'

const DEFAULT_API_BASE_URL = 'https://api.solvapay.com'
const DEV_API_BASE_URL = 'https://api-dev.solvapay.com'

export type DoctorCommandOptions = {
  /** Target api-dev.solvapay.com (same as `solvapay init --dev`). */
  dev?: boolean
}

export type RunDoctorInDirectoryOptions = {
  cwd: string
  options?: DoctorCommandOptions
  /** npm dist-tag lookup, injectable for tests. */
  distTags?: FetchDistTags
  /** Published Python / Go SDK versions, injectable for tests. */
  sdkVersions?: (language: SdkLanguage) => Promise<string[]>
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

const resolveApiBaseUrl = async (
  cwd: string,
  opts: DoctorCommandOptions,
): Promise<string> => {
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
/** Whether the project's `@solvapay/*` packages match npm (`latest`, or `preview` for a preview build). */
const checkNpmVersions = async (
  cwd: string,
  names: string[],
  distTags: FetchDistTags,
): Promise<DoctorCheckResult> => {
  const name = '@solvapay/* versions'
  try {
    const outdated = await findOutdatedSolvapayPackages(cwd, names, distTags)
    if (outdated.length === 0) return { name, ok: true, detail: `${names.length} package(s) match npm` }
    const behind = outdated.map(o => `${o.name} ${o.installed} (npm ${o.tag} ${o.wanted})`).join(', ')
    const command = upgradeCommand(await detectPackageManager(cwd), outdated)
    return { name, ok: false, detail: `behind npm: ${behind}. Upgrade with: ${command}` }
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

const SDK_CHECK_NAMES: Record<SdkLanguage, string> = {
  python: 'solvapay (Python) version',
  go: 'solvapay-sdk/go version',
}
const REGISTRY_NAMES: Record<SdkLanguage, string> = { python: 'PyPI', go: 'the Go proxy' }

/**
 * Whether the installed Python or Go SDK is the newest release: the newest
 * stable for a stable install, the newest version of any kind for a preview.
 */
const checkLanguageVersion = async (
  sdk: InstalledSdk,
  sdkVersions: (language: SdkLanguage) => Promise<string[]>,
): Promise<DoctorCheckResult> => {
  const name = SDK_CHECK_NAMES[sdk.language]
  try {
    const published = await sdkVersions(sdk.language)
    const preview = isSdkPreview(sdk.language, sdk.version)
    const wanted = preview
      ? newestAny(sdk.language, published)
      : newestStable(sdk.language, published)
    if (!wanted) {
      throw new Error(`${REGISTRY_NAMES[sdk.language]} lists no ${preview ? '' : 'stable '}release`)
    }
    const behind = preview
      ? sdk.version !== wanted
      : compareSdkVersions(sdk.language, sdk.version, wanted) < 0
    const label = preview ? 'newest preview' : 'newest release'
    if (!behind) {
      return { name, ok: true, detail: `${sdk.version} (${sdk.source}) is the ${label}` }
    }
    return {
      name,
      ok: false,
      detail: `${sdk.version} (${sdk.source}) is behind the ${label} ${wanted}. Upgrade with: ${languageUpgradeCommand(sdk, wanted)}`,
    }
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * One version check per language the project uses SolvaPay in. A project
 * with no SolvaPay SDK in any language fails: doctor has nothing to vouch for.
 * Also returns the `@solvapay/*` npm packages found, `null` without a
 * readable package.json.
 */
const checkSdkVersions = async (
  cwd: string,
  distTags: FetchDistTags,
  sdkVersions: (language: SdkLanguage) => Promise<string[]>,
): Promise<{ results: DoctorCheckResult[]; npmNames: string[] | null }> => {
  const results: DoctorCheckResult[] = []
  let npmNames: string[] | null = null
  try {
    npmNames = await solvapayDependencies(cwd)
  } catch (error) {
    results.push({
      name: '@solvapay/* versions',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }
  if (npmNames && npmNames.length > 0) results.push(await checkNpmVersions(cwd, npmNames, distTags))

  for (const [language, read] of [
    ['python', installedPythonSdk],
    ['go', installedGoSdk],
  ] as const) {
    try {
      const sdk = await read(cwd)
      if (sdk) results.push(await checkLanguageVersion(sdk, sdkVersions))
    } catch (error) {
      results.push({
        name: SDK_CHECK_NAMES[language],
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (results.length === 0) {
    results.push({
      name: 'SolvaPay SDK',
      ok: false,
      detail:
        `no SolvaPay SDK found in ${cwd} (no @solvapay/* in package.json, no solvapay in ` +
        'uv.lock, poetry.lock or requirements.txt, no github.com/solvapay/solvapay-sdk/go in go.mod). ' +
        'Run `npx solvapay init` here, or run doctor from the project folder.',
    })
  }
  return { results, npmNames }
}

/**
 * Imports that need `mcp` 1.x (`mcp.server.fastmcp`, `fastapi_mcp`) fail
 * once the project is on `mcp` 2.x, which `solvapay[mcp]` requires. A version
 * check can't catch it: with the SDK installed, `mcp` is always 2.3 or later.
 */
const checkPythonMcpImports = async (cwd: string): Promise<DoctorCheckResult> => {
  const name = 'Python MCP imports'
  try {
    const project = await inspectPythonMcpProject(cwd)
    const legacy = describeLegacyImports(project.imports)
    const fastmcp = project.imports.filter(hit => hit.module === 'fastmcp')
    if (legacy.length > 0) {
      const mcpLabel = project.mcp
        ? `mcp ${project.mcp.version} in ${project.mcp.source}`
        : 'mcp version not pinned'
      const stillOnV1 =
        project.mcp !== undefined && majorVersion(project.mcp.version) < 2 && !project.solvapayMcpExtra
      if (stillOnV1) {
        return {
          name,
          ok: true,
          detail: `warning: ${legacy.join('; ')}. This code runs today (${mcpLabel}), but SolvaPay's MCP server needs mcp 2.3 or later. Migrate before adding it: ${MCP_MIGRATION_GUIDE}`,
        }
      }
      return {
        name,
        ok: false,
        detail: `${legacy.join('; ')}, so the server can't start on mcp 2.x (${mcpLabel}). Migrate: ${MCP_MIGRATION_GUIDE}, then register the tools on create_solvapay_mcp_server: ${PYTHON_MCP_GUIDE}`,
      }
    }
    if (fastmcp.length > 0) {
      const at = fastmcp.slice(0, 3).map(hit => `${hit.file}:${hit.line}`).join(', ')
      return {
        name,
        ok: true,
        detail: `warning: ${at} imports fastmcp. SolvaPay has no fastmcp adapter; paid tools register on create_solvapay_mcp_server: ${PYTHON_MCP_GUIDE}`,
      }
    }
    return { name, ok: true, detail: 'none that need mcp 1.x' }
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

export const runDoctorInDirectory = async ({
  cwd,
  options = {},
  distTags = fetchDistTags,
  sdkVersions = fetchSdkVersions,
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
      detail: verified.ok
        ? 'accepted by the API'
        : (verified.warning ?? 'rejected by the API'),
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

  const sdkChecks = await checkSdkVersions(cwd, distTags, sdkVersions)
  checks.push(...sdkChecks.results)

  const markers = await findLanguageMarkers(cwd)
  if (markers.some(marker => marker.language === 'python')) {
    checks.push(await checkPythonMcpImports(cwd))
  }

  // The TypeScript factory and paywall read SOLVAPAY_DEBUG differently; the
  // Python and Go SDKs don't, so the warning is for TypeScript projects only.
  if (sdkChecks.npmNames && sdkChecks.npmNames.length > 0) {
    const debugRaw = process.env.SOLVAPAY_DEBUG
    checks.push({
      name: 'SOLVAPAY_DEBUG defaults',
      ok: true,
      detail:
        debugRaw === undefined
          ? 'warning: unset — factory treats debug as ON (!== "false") while client/paywall treat it as OFF (=== "true"). Set explicitly to "true" or "false".'
          : `set to "${debugRaw}"`,
    })
  }

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
