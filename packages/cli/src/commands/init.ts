import {
  createInitSession,
  openAuthUrl,
  verifyProductRef,
  verifySecretKey,
  waitForExchange,
} from '../lib/browser-auth'
import chalk from 'chalk'
import {
  ensureEnvInGitignore,
  readSolvaPayProductRefFromEnv,
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER,
  writeSolvaPayProductRefToEnv,
  writeSolvaPaySecretToEnv,
} from '../lib/env'
import {
  askKeepConfiguredProduct,
  formatConfiguredProductLabel,
  pickProductInteractive,
} from '../lib/product-picker'
import { listProducts } from '../lib/products'
import { getInstallCommand, getSolvaPayBasePackages, installSolvaPaySdk } from '../lib/install'
import { detectPackageManager, ensureNodeProject, waitForEnter } from '../lib/project'

const DEFAULT_API_BASE_URL = 'https://api.solvapay.com'

const resolveApiBaseUrl = (): string =>
  (process.env.SOLVAPAY_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')

const ASCII_BANNER = ` ____        _            ____
/ ___|  ___ | |_   ____ _|  _ \\ __ _ _   _
\\___ \\ / _ \\| \\ \\ / / _\` | |_) / _\` | | | |
 ___) | (_) | |\\ V / (_| |  __/ (_| | |_| |
|____/ \\___/|_| \\_/ \\__,_|_|   \\__,_|\\__, |
                                      |___/`

const printBanner = (): void => {
  process.stdout.write(`${chalk.cyanBright(ASCII_BANNER)}\n\n`)
}

const printQuickStart = (): void => {
  process.stdout.write(`
You're all set! Here's how to get started:

  import { SolvaPay } from '@solvapay/server';
  const sp = new SolvaPay();

Docs: https://docs.solvapay.com
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
}

const configureProductRef = async (
  apiBaseUrl: string,
  secretKey: string,
  cwd: string,
  options: InitCommandOptions,
): Promise<void> => {
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
      break
  }
}

export const runInitCommand = async (options: InitCommandOptions = {}): Promise<void> => {
  const apiBaseUrl = resolveApiBaseUrl()
  const cwd = process.cwd()
  printBanner()

  const projectCheck = await ensureNodeProject({ autoCreate: options.yes })
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

  const envWrite = await writeSolvaPaySecretToEnv(exchange.secretKey)
  const environmentLabel = exchange.environment ? ` (${exchange.environment})` : ''
  if (envWrite.action === 'created' || envWrite.action === 'appended' || envWrite.action === 'updated') {
    process.stdout.write(`📝 Secret key saved to .env${environmentLabel}\n`)
  } else {
    process.stdout.write(`📝 Kept existing SOLVAPAY_SECRET_KEY in .env${environmentLabel}\n`)
  }
  if (exchange.warning) {
    process.stdout.write(`⚠️ ${exchange.warning}\n`)
  }

  const gitignoreWrite = await ensureEnvInGitignore(cwd)
  if (gitignoreWrite.action === 'created' || gitignoreWrite.action === 'appended') {
    process.stdout.write('🔒 Added .env to .gitignore\n')
  }

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

  const verified = await verifySecretKey(apiBaseUrl, exchange.secretKey)
  if (verified.ok) {
    process.stdout.write('✅ Secret key verified with SolvaPay\n')
  } else {
    process.stdout.write(
      `⚠️ Verification failed, but setup can still continue. Details: ${verified.warning}\n`,
    )
  }

  await configureProductRef(apiBaseUrl, exchange.secretKey, cwd, options)

  process.stdout.write('\n')
  printQuickStart()
}
