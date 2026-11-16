import chalk from 'chalk'
import {
  createInitSession,
  openAuthUrl,
  verifyMerchant,
  verifyProductRef,
  verifySecretKey,
  waitForExchange,
} from './browser-auth'
import {
  ensureEnvInGitignore,
  readSolvaPayProductRefFromEnv,
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER,
  writeMcpServerEnvDefaults,
  writeSolvaPayApiBaseUrlToEnv,
  writeSolvaPayProductRefToEnv,
  writeSolvaPaySecretToEnv,
} from './env'
import {
  formatCommand,
  getInstallCommand,
  getSolvaPayBasePackages,
  goInstallCommands,
  installSolvaPaySdk,
  pythonInstallCommands,
  pythonRequirement,
  runSdkCommand,
  type SdkCommand,
  type SdkFeature,
} from './install'
import { detectProject, LANGUAGE_LABELS, type DetectedProject, type Language } from './language'
import {
  askKeepConfiguredProduct,
  formatConfiguredProductLabel,
  pickProductInteractive,
} from './product-picker'
import { listProducts } from './products'
import { waitForEnter } from './project'
import {
  fastmcpUses,
  inspectPythonMcpProject,
  MCP_MIGRATION_GUIDE,
  PYTHON_MCP_GUIDE,
  pythonMcpBlockers,
} from './python-mcp'
import { fetchSdkVersions, GO_MODULE, pickSdkVersion, type SdkLanguage } from './sdk-registry'

const DEFAULT_API_BASE_URL = 'https://api.solvapay.com'
const DEV_API_BASE_URL = 'https://api-dev.solvapay.com'

const resolveApiBaseUrl = (opts: InitCommandOptions): string => {
  // `--dev` is the highest-priority signal — when set, it overrides any
  // leaked `SOLVAPAY_API_BASE_URL` in the shell so the dev-mode story
  // ("one flag, every layer hits api-dev") holds even on machines that
  // have an old override lingering in `~/.zshrc` / `.envrc`.
  if (opts.dev) return DEV_API_BASE_URL
  return (process.env.SOLVAPAY_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')
}

const ASCII_BANNER = ` ____        _            ____
/ ___|  ___ | |_   ____ _|  _ \\ __ _ _   _
\\___ \\ / _ \\| \\ \\ / / _\` | |_) / _\` | | | |
 ___) | (_) | |\\ V / (_| |  __/ (_| | |_| |
|____/ \\___/|_| \\_/ \\__,_|_|   \\__,_|\\__, |
                                      |___/`

const printBanner = (): void => {
  process.stdout.write(`${chalk.cyanBright(ASCII_BANNER)}\n\n`)
}

const PYTHON_DOCS = 'https://docs.solvapay.com/sdks/python/setup/quick-start'
const GO_DOCS = 'https://docs.solvapay.com/sdks/go/setup/quick-start'
const GO_MCP_GUIDE = 'https://docs.solvapay.com/sdks/go/guides/mcp'

type SetupSummary = {
  printed: SdkCommand[]
  features: SdkFeature[]
  /** `npx -y solvapay@<tag>`: `preview` from a preview CLI, else `latest`. */
  cliTag: 'latest' | 'preview'
}

const printSetupComplete = (
  project: DetectedProject,
  { printed, features, cliTag }: SetupSummary,
): void => {
  if (project.language === 'ts') {
    process.stdout.write(`
You're all set. SolvaPay credentials were saved to .env.

Continue with the next step in your setup when you're ready.
`)
    return
  }
  const lines = ['', 'SolvaPay credentials were saved to .env.', '']
  if (printed.length > 0) {
    lines.push('Install the SDK into your environment (init does not choose an interpreter):')
    for (const command of printed) lines.push(`   ${formatCommand(command)}`)
    lines.push('')
  }
  const python = project.language === 'python'
  const mcp = features.includes('mcp')
  const cli = `npx -y solvapay@${cliTag}`
  lines.push(
    `The ${LANGUAGE_LABELS[project.language]} SDK reads environment variables, not .env. Load .env at startup`,
    python
      ? '(python-dotenv: `load_dotenv()`), or export the variables before you run the app.'
      : '(read it in main), or export the variables before you run the app.',
    '',
    'Next steps:',
  )
  if (mcp) {
    lines.push(
      `   Build the MCP server: ${python ? PYTHON_MCP_GUIDE : GO_MCP_GUIDE}`,
      `     (${python ? 'create_solvapay_mcp_server' : 'solvapay.NewMCPServer'}; set PUBLIC_BASE_URL in .env to your tunnel URL for remote clients)`,
      `   Check a running MCP server: ${cli} verify <server url>/mcp`,
    )
  } else {
    lines.push(`   Docs: ${python ? PYTHON_DOCS : GO_DOCS}`)
  }
  lines.push(`   Check this project:         ${cli} doctor`, '')
  process.stdout.write(lines.join('\n'))
}

/**
 * Stops a Python MCP setup before sign-in when installing `solvapay[mcp]`
 * would upgrade `mcp` to 2.x under code that needs 1.x. Warns on fastmcp,
 * which SolvaPay has no adapter for.
 */
const checkPythonMcpProject = async (cwd: string): Promise<void> => {
  const project = await inspectPythonMcpProject(cwd)
  const blockers = pythonMcpBlockers(project)
  if (blockers.length > 0) {
    const usesFastapiMcp =
      project.fastapiMcp.length > 0 || project.imports.some(hit => hit.module === 'fastapi_mcp')
    throw new Error(
      [
        "This project can't take SolvaPay's MCP server yet. solvapay[mcp] needs mcp 2.3 or later,",
        'and installing it here would upgrade mcp under code that needs 1.x:',
        ...blockers.map(blocker => `  - ${blocker}`),
        '',
        `Migrate to mcp 2.x first: ${MCP_MIGRATION_GUIDE}`,
        `Then register your tools on create_solvapay_mcp_server: ${PYTHON_MCP_GUIDE}`,
        ...(usesFastapiMcp
          ? [
              'fastapi-mcp has no mcp 2.x release: write its tools by hand, calling your route functions.',
            ]
          : []),
        'Run init again after that. Nothing was written.',
      ].join('\n'),
    )
  }
  const fastmcp = fastmcpUses(project)
  if (fastmcp.length > 0) {
    process.stdout.write(
      [
        `⚠️ This project uses fastmcp (${fastmcp.join(', ')}). SolvaPay has no fastmcp adapter:`,
        '   paid tools register on create_solvapay_mcp_server, which runs on the official mcp SDK.',
        `   ${PYTHON_MCP_GUIDE}`,
        '',
      ].join('\n'),
    )
  }
}

const createInstallProgressReporter = (): ((message: string) => void) => {
  if (!process.stdout.isTTY) {
    return message => {
      process.stdout.write(`📦 ${message}\n`)
    }
  }

  let lastRenderedLength = 0
  return message => {
    const line = `📦 ${message}`
    const paddedLine =
      line.length < lastRenderedLength ? `${line}${' '.repeat(lastRenderedLength - line.length)}` : line

    process.stdout.write(`\r${paddedLine}`)
    lastRenderedLength = line.length
  }
}

const finishInstallProgressReporter = (): void => {
  if (process.stdout.isTTY) {
    process.stdout.write('\n')
  }
}

export type InitCommandOptions = {
  yes?: boolean
  /**
   * Product reference to verify and persist without invoking the picker.
   * Used by `solvapay init --product <prd_...>` and forwarded by
   * `create-solvapay --product <prd_...>`.
   */
  productRef?: string
  /**
   * Target the SolvaPay dev backend (`https://api-dev.solvapay.com`) for
   * the browser-auth flow + every downstream `.env`-driven SDK call.
   * Internal testing only — production secret keys are rejected by
   * `api-dev`. Persisted to `.env` as `SOLVAPAY_API_BASE_URL` so
   * `wrangler dev` and `scripts/deploy.mjs` pick the same origin without
   * any further user action.
   */
  dev?: boolean
  /**
   * `--language ts|python|go`: the project's language. Needed when the folder
   * has markers for two languages, or none, and no one can answer a prompt.
   */
  language?: Language
  /**
   * Install the newest preview of the SDK (npm `preview` tag, newest PyPI /
   * Go proxy pre-release) instead of the newest stable release. Not a flag:
   * the CLI sets it when it is itself a preview build, so the preview CLI
   * and the preview SDKs always go together.
   */
  preview?: boolean
  /** `--features mcp,agents,web`: Python extras, or extra TypeScript packages. */
  features?: SdkFeature[]
}

export type RunInitInDirectoryOptions = {
  cwd: string
  options?: InitCommandOptions
  /**
   * When true, skip the `installSolvaPaySdk` step. `create-solvapay`
   * sets this because the scaffolded `package.json` ships the right MCP
   * deps (`@solvapay/mcp`, `@solvapay/react`, MCP SDK, wrangler, vite...)
   * and runs its own project-local `npm install` before delegating.
   * `solvapay init` keeps the default (`false`) so existing projects get
   * the SolvaPay base packages installed for them.
   */
  skipSdkInstall?: boolean
  /** Published Python / Go SDK versions; injectable for tests. */
  sdkVersions?: (language: SdkLanguage) => Promise<string[]>
  /** Whether a person can answer prompts; defaults to a TTY on both ends without --yes. */
  interactive?: boolean
}

const configureProductRef = async (
  apiBaseUrl: string,
  secretKey: string,
  cwd: string,
  options: InitCommandOptions,
): Promise<void> => {
  if (options.productRef) {
    const verified = await verifyProductRef(apiBaseUrl, secretKey, options.productRef)
    if (verified.status !== 'ok') {
      const detail =
        verified.status === 'not_found'
          ? verified.body
          : verified.status === 'error'
            ? verified.message
            : verified.status
      throw new Error(
        `Could not verify SOLVAPAY_PRODUCT_REF ${options.productRef}: ${detail}. ` +
          'Confirm the product belongs to this SolvaPay account and re-run init.',
      )
    }
    await writeSolvaPayProductRefToEnv(options.productRef, { cwd })
    process.stdout.write(`✅ Product ref verified (${options.productRef})\n`)
    return
  }

  const existing = await readSolvaPayProductRefFromEnv(cwd)

  if (existing && existing !== SOLVAPAY_PRODUCT_REF_PLACEHOLDER) {
    const verified = await verifyProductRef(apiBaseUrl, secretKey, existing)
    if (verified.status === 'ok') {
      if (options.yes) {
        process.stdout.write(`✅ Product ref verified (${existing})\n`)
        return
      }

      const listResult = await listProducts(apiBaseUrl, secretKey)
      const label =
        listResult.ok && listResult.products.length > 0
          ? formatConfiguredProductLabel(existing, listResult.products)
          : existing

      const keep = await askKeepConfiguredProduct(label)
      if (keep) {
        process.stdout.write(`✅ Product ref verified (${existing})\n`)
        return
      }
    } else if (verified.status === 'error') {
      process.stdout.write(
        `⚠️ Product ref verification failed, but setup can still continue. Details: ${verified.message}\n`,
      )
    }
  }

  const pick = await pickProductInteractive(apiBaseUrl, secretKey, {
    yes: options.yes ?? false,
  })

  switch (pick.action) {
    case 'picked': {
      const writeResult = await writeSolvaPayProductRefToEnv(pick.product.reference, { cwd })
      if (writeResult.action === 'created' || writeResult.action === 'updated') {
        process.stdout.write(
          `📝 Product configured: ${pick.product.name} (${pick.product.reference})\n`,
        )
      } else if (writeResult.action === 'appended') {
        process.stdout.write(
          `📝 Product ref saved: ${pick.product.name} (${pick.product.reference})\n`,
        )
      } else {
        process.stdout.write(`✅ Product ref verified (${pick.product.reference})\n`)
      }
      break
    }
    case 'declined':
      process.stdout.write('Skipped — set SOLVAPAY_PRODUCT_REF in .env later.\n')
      break
    case 'skipped':
      if (pick.reason === 'non_interactive_requires_product') {
        process.stdout.write(
          'No product ref was saved. Set SOLVAPAY_PRODUCT_REF in .env or re-run `solvapay init --product <prd_...>` after confirming the intended product.\n',
        )
      }
      break
  }
}

const resolveSdkPin = async (
  project: DetectedProject,
  options: InitCommandOptions,
  sdkVersions: (language: SdkLanguage) => Promise<string[]>,
): Promise<string | undefined> => {
  if (project.language === 'ts') return undefined
  return pickSdkVersion(project.language, await sdkVersions(project.language), {
    preview: options.preview ?? false,
  })
}

const installLanguageSdk = async (
  project: DetectedProject & { language: 'python' | 'go' },
  version: string,
  cwd: string,
  features: SdkFeature[],
): Promise<SdkCommand[]> => {
  const { run, print } =
    project.language === 'python'
      ? pythonInstallCommands(project.manager, version, features)
      : { run: goInstallCommands(version), print: [] as SdkCommand[] }
  for (const command of run) {
    process.stdout.write(`📦 ${formatCommand(command)}\n`)
    const result = await runSdkCommand(command, cwd)
    if (!result.ok) {
      throw new Error(
        `\`${result.command}\` failed: ${result.warning ?? 'unknown error'}\n` +
          'Fix the cause and run it yourself; .env is already complete.',
      )
    }
  }
  if (run.length > 0) {
    const label =
      project.language === 'python'
        ? pythonRequirement(version, features)
        : `${GO_MODULE}@${version}`
    process.stdout.write(`✅ SolvaPay SDK pinned: ${label}\n`)
  }
  return print
}

export const runInitInDirectory = async ({
  cwd,
  options = {},
  skipSdkInstall = false,
  sdkVersions = fetchSdkVersions,
  interactive = !options.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY),
}: RunInitInDirectoryOptions): Promise<void> => {
  const apiBaseUrl = resolveApiBaseUrl(options)
  printBanner()

  if (options.dev) {
    process.stdout.write(
      `🧪 Targeting SolvaPay dev backend (${DEV_API_BASE_URL}) — internal testing only.\n`,
    )
  }

  // Decide the language, and the SDK version to pin, before the browser
  // opens: a folder init can't handle fails here, with nothing written.
  const project = await detectProject(cwd, { language: options.language, interactive })
  if (project.language === 'ts') {
    process.stdout.write(
      `🔍 Detected ${project.manager} project (package.json ${project.createdPackageJson ? 'created' : 'found'})\n`,
    )
  } else {
    process.stdout.write(
      `🔍 Detected ${LANGUAGE_LABELS[project.language]} project (${project.manager})\n`,
    )
  }
  const features = options.features ?? []
  if (project.language === 'python' && features.includes('mcp')) {
    await checkPythonMcpProject(cwd)
  }
  const sdkPin = skipSdkInstall ? undefined : await resolveSdkPin(project, options, sdkVersions)
  if (sdkPin && options.preview) {
    process.stdout.write(`🧪 Preview SDK: ${sdkPin}\n`)
  }

  const initSession = await createInitSession(apiBaseUrl)
  process.stdout.write(`🌐 Browser authentication URL: ${initSession.authUrl}\n`)
  if (!options.yes) {
    await waitForEnter(
      'Press Enter to open your browser to authenticate and set up your account if you do not already have one. ',
    )
  }
  process.stdout.write('🌐 Opening browser for authentication...\n')

  const opened = await openAuthUrl(initSession.authUrl)
  if (!opened) {
    process.stdout.write(`   If it doesn't open, visit: ${initSession.authUrl}\n`)
  }

  const exchange = await waitForExchange(apiBaseUrl, initSession)

  if (exchange.status === 'cancelled') {
    throw new Error('Authentication was cancelled. Run `solvapay init` again when you are ready.')
  }
  if (exchange.status === 'expired') {
    throw new Error(
      'Timed out after 10 minutes waiting for authentication. Run `solvapay init` again.',
    )
  }
  if (exchange.status !== 'complete' || !exchange.secretKey) {
    throw new Error('Could not retrieve a SolvaPay secret key from the init session.')
  }

  if (exchange.email) {
    process.stdout.write(`✅ Authenticated as ${exchange.email}\n`)
  } else {
    process.stdout.write('✅ Authenticated\n')
  }

  // Probe the backend BEFORE touching the project. Two checks run here:
  //   1. `verifySecretKey` — asserts the key authenticates (says nothing
  //      about whether a merchant record exists).
  //   2. `verifyMerchant`  — asserts a merchant record exists in the key's
  //      environment. Without it, every paid-MCP bootstrap call would 404
  //      post-deploy. Failing here keeps the project clean instead of
  //      leaving a half-scaffolded `.env` + `node_modules` behind.
  const verified = await verifySecretKey(apiBaseUrl, exchange.secretKey)
  if (verified.ok) {
    process.stdout.write('✅ Secret key authenticates\n')
  } else {
    process.stdout.write(
      `⚠️ Verification failed, but setup can still continue. Details: ${verified.warning}\n`,
    )
  }

  // Hard-block when the SolvaPay backend has no merchant record for this
  // secret key. `verifySecretKey` only asserts the key authenticates —
  // a key without a merchant still passes that check but every paid-MCP
  // bootstrap call would fail with `Provider not found (404)` post-deploy.
  // The hard-fail here moves that error to setup time where the recovery
  // path (re-running `solvapay init` once the user finishes onboarding)
  // is obvious.
  const merchant = await verifyMerchant(apiBaseUrl, exchange.secretKey)
  if (merchant.status === 'not_found') {
    const env = merchant.environment ?? exchange.environment
    const envLabel = env ? ` in the ${env} environment` : ''
    // When the backend confirms a sandbox provider doc exists for this
    // key but the requested env is missing, the user's recovery path is
    // "finish live promotion in the Console" — not "complete onboarding".
    const isLivePromotionGap = env === 'live' && merchant.providerExistsInSandbox === true
    const recoveryLines = isLivePromotionGap
      ? [
          '   Your sandbox account exists, but your live environment',
          '   isn\'t fully promoted yet. Switch to live in the SolvaPay',
          '   Console (https://app.solvapay.com), then re-run',
          '   `npx solvapay init` to pick up the live credentials.',
          '',
          '   Or re-run with the sandbox key for now to keep testing.',
        ]
      : [
          '   No merchant record was found for this secret key.',
          '   Finish provider onboarding in the SolvaPay Console',
          '   (https://app.solvapay.com), then re-run `npx solvapay init`',
          '   to pick up the new credentials.',
        ]
    process.stdout.write(
      [
        '',
        `❌ Provider account not found${envLabel}.`,
        '',
        ...recoveryLines,
        '',
      ].join('\n'),
    )
    throw new Error(
      `Provider account not found${envLabel} — finish onboarding in the SolvaPay Console and re-run \`npx solvapay init\`.`,
    )
  }
  if (merchant.status === 'env_mismatch') {
    process.stdout.write(
      [
        '',
        '❌ Secret key environment does not match the provider environment.',
        '',
        `   Key is for: ${merchant.keyEnvironment ?? 'unknown'}`,
        `   Provider is currently: ${merchant.providerEnvironment ?? 'unknown'}`,
        '',
        '   Switch the provider environment in the SolvaPay Console',
        '   (https://app.solvapay.com) to match this key, or re-run',
        '   `npx solvapay init` to issue a key for the active env.',
        '',
      ].join('\n'),
    )
    throw new Error(
      `Secret key environment (${merchant.keyEnvironment ?? 'unknown'}) does not match the provider environment (${merchant.providerEnvironment ?? 'unknown'}).`,
    )
  }
  if (merchant.status === 'unauthorized') {
    process.stdout.write(
      '⚠️ Merchant lookup unauthorized — continuing, but paid tools may fail until the secret key is fixed.\n',
    )
  } else if (merchant.status === 'error') {
    process.stdout.write(
      `⚠️ Merchant lookup failed, but setup can still continue. Details: ${merchant.message}\n`,
    )
  }

  if (exchange.environment === 'live') {
    process.stdout.write(
      [
        '',
        '⚠️  LIVE key. Real charges apply.',
        '   Init follows the environment currently selected in the SolvaPay Console.',
        '   Switch the Console to sandbox and re-run `npx solvapay init` if that was not intended.',
        '',
      ].join('\n'),
    )
  }

  const envWrite = await writeSolvaPaySecretToEnv(exchange.secretKey, {
    cwd,
    ...(options.yes ? { confirmOverwrite: async () => true } : {}),
  })
  const environmentLabel = exchange.environment ? ` (${exchange.environment})` : ''
  if (envWrite.action === 'created' || envWrite.action === 'appended' || envWrite.action === 'updated') {
    process.stdout.write(`📝 Secret key saved to .env${environmentLabel}\n`)
  } else {
    process.stdout.write(`📝 Kept existing SOLVAPAY_SECRET_KEY in .env${environmentLabel}\n`)
  }
  if (exchange.warning) {
    process.stdout.write(`⚠️ ${exchange.warning}\n`)
  }

  // Persist `SOLVAPAY_API_BASE_URL=…` when `--dev` is set so subsequent
  // `wrangler dev` / `scripts/deploy.mjs` preflight + `--var` upload all
  // hit api-dev without the user re-passing the flag or exporting the
  // variable. Production (`opts.dev === false`) deliberately does NOT
  // touch this — leaving the line absent / commented-out keeps the
  // worker on its built-in `https://api.solvapay.com` default.
  if (options.dev) {
    const apiBaseWrite = await writeSolvaPayApiBaseUrlToEnv(DEV_API_BASE_URL, { cwd })
    if (apiBaseWrite.action !== 'unchanged') {
      process.stdout.write(`📝 SOLVAPAY_API_BASE_URL pinned to ${DEV_API_BASE_URL} in .env\n`)
    }
  }

  const gitignoreWrite = await ensureEnvInGitignore(cwd)
  if (gitignoreWrite.action === 'created' || gitignoreWrite.action === 'appended') {
    process.stdout.write('🔒 Added .env to .gitignore\n')
  }

  // Product and server settings go into .env before the SDK install, so an
  // install that fails still leaves a complete .env behind.
  await configureProductRef(apiBaseUrl, exchange.secretKey, cwd, options)

  if (project.language !== 'ts' && features.includes('mcp')) {
    const added = await writeMcpServerEnvDefaults({ cwd })
    if (added.length > 0) process.stdout.write(`📝 ${added.join(' and ')} added to .env\n`)
  }

  let printed: SdkCommand[] = []
  if (!skipSdkInstall && project.language === 'ts') {
    const tsOptions = {
      distTag: options.preview ? ('preview' as const) : ('latest' as const),
      features,
    }
    const onInstallProgress = createInstallProgressReporter()
    onInstallProgress('Resolving packages')
    const installResult = await installSolvaPaySdk(
      project.manager,
      cwd,
      onInstallProgress,
      tsOptions,
    )
    finishInstallProgressReporter()
    if (installResult.ok) {
      process.stdout.write('✅ SolvaPay SDK packages installed\n')
      const installedPackages = getSolvaPayBasePackages(features)
      const packageList = installedPackages.join(', ')
      process.stdout.write(`📦 Added ${installedPackages.length} packages: ${packageList}\n`)
    } else {
      const manualInstallCommand = await getInstallCommand(project.manager, tsOptions)
      process.stdout.write(
        `⚠️ Install failed (${installResult.warning || 'unknown error'}). Run manually: ${manualInstallCommand}\n`,
      )
    }
  } else if (sdkPin && project.language !== 'ts') {
    printed = await installLanguageSdk(project, sdkPin, cwd, features)
  }

  process.stdout.write('\n')
  printSetupComplete(project, {
    printed,
    features,
    cliTag: options.preview ? 'preview' : 'latest',
  })
}
