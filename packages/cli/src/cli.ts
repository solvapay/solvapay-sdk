import { runInitCommand } from './commands/init'
import { PACKAGE_VERSION, printVersionBanner } from './version-banner'

const HELP_TEXT = `SolvaPay CLI

Usage:
  solvapay <command> [flags]

Commands:
  init    Authenticate, configure .env, and install SolvaPay SDK packages

Flags for init:
  -y, --yes         Auto-create package.json and skip browser confirmation prompt
  --product <ref>   Verify and persist SOLVAPAY_PRODUCT_REF without product picker
  --dev             Target the SolvaPay dev backend (api-dev.solvapay.com).
                    Internal testing only — production secret keys are rejected
                    by api-dev. Persisted to .env as SOLVAPAY_API_BASE_URL.
`

function parseInitArgs(argv: string[]): { yes: boolean; dev: boolean; productRef?: string } {
  let yes = false
  let dev = false
  let productRef: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--yes' || arg === '-y') {
      yes = true
    } else if (arg === '--dev') {
      dev = true
    } else if (arg === '--product') {
      productRef = argv[++i]
      if (!productRef || productRef.startsWith('-')) {
        throw new Error('--product requires a product reference')
      }
    }
  }
  return { yes, dev, productRef }
}

const main = async () => {
  const command = process.argv[2]

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${HELP_TEXT}\n`)
    return
  }

  if (command === '--version' || command === '-v') {
    process.stdout.write(`${PACKAGE_VERSION}\n`)
    return
  }

  if (command === 'init') {
    printVersionBanner()
    await runInitCommand(parseInitArgs(process.argv.slice(3)))
    return
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP_TEXT}\n`)
  process.exitCode = 1
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  process.stderr.write(`Error: ${message}\n`)
  process.exitCode = 1
})
