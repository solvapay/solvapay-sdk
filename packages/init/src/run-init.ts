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
  writeSolvaPayApiBaseUrlToEnv,
  writeSolvaPayProductRefToEnv,
  writeSolvaPaySecretToEnv,
} from './env'
import { getInstallCommand, getSolvaPayBasePackages, installSolvaPaySdk } from './install'
import {
  askKeepConfiguredProduct,
  formatConfiguredProductLabel,
  pickProductInteractive,
} from './product-picker'
import { listProducts } from './products'
import { detectPackageManager, ensureNodeProject, waitForEnter } from './project'

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

const printSetupComplete = (): void => {
  process.stdout.write(`
You're all set. SolvaPay credentials were saved to .env.

Continue with the next step in your setup when you're ready.
`)
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

export const runInitInDirectory = async ({
  cwd,
  options = {},
  skipSdkInstall = false,
}: RunInitInDirectoryOptions): Promise<void> => {
  const apiBaseUrl = resolveApiBaseUrl(options)
  printBanner()

  if (options.dev) {
    process.stdout.write(
      `🧪 Targeting SolvaPay dev backend (${DEV_API_BASE_URL}) — internal testing only.\n`,
    )
  }

  const projectCheck = await ensureNodeProject({ cwd, autoCreate: options.yes })
  if (projectCheck.action === 'cancelled') {
    process.stdout.write('Initialization cancelled. Run `npm init -y` first, then `solvapay init`.\n')
    return
  }

  const packageManager = await detectPackageManager(cwd)
  if (projectCheck.action === 'created') {
    process.stdout.write(`🔍 Detected ${packageManager} project (package.json created)\n`)
  } else {
    process.stdout.write(`🔍 Detected ${packageManager} project (package.json found)\n`)
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

  const envWrite = await writeSolvaPaySecretToEnv(exchange.secretKey, { cwd })
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

  if (!skipSdkInstall) {
    const onInstallProgress = createInstallProgressReporter()
    onInstallProgress('Resolving packages')
    const installResult = await installSolvaPaySdk(packageManager, cwd, onInstallProgress)
    finishInstallProgressReporter()
    if (installResult.ok) {
      process.stdout.write('✅ SolvaPay SDK packages installed\n')
      const installedPackages = getSolvaPayBasePackages()
      const packageList = installedPackages.join(', ')
      process.stdout.write(`📦 Added ${installedPackages.length} packages: ${packageList}\n`)
    } else {
      const manualInstallCommand = await getInstallCommand(packageManager)
      process.stdout.write(
        `⚠️ Install failed (${installResult.warning || 'unknown error'}). Run manually: ${manualInstallCommand}\n`,
      )
    }
  }

  await configureProductRef(apiBaseUrl, exchange.secretKey, cwd, options)

  process.stdout.write('\n')
  printSetupComplete()
}
