import { runDoctorCommand } from './commands/doctor'
import { runInitCommand } from './commands/init'
import { PACKAGE_VERSION, printVersionBanner } from './version-banner'

const HELP_TEXT = `SolvaPay CLI

Usage:
  solvapay <command> [flags]

Commands:
  init    Authenticate, configure .env, and install SolvaPay SDK packages
  doctor  Verify secret key, API URL, product ref, and product readiness

Flags for init:
  -y, --yes         Auto-create package.json and skip browser confirmation prompt
  --product <ref>   Verify and persist SOLVAPAY_PRODUCT_REF without product picker
  --dev             Target the SolvaPay dev backend (api-dev.solvapay.com).
                    Internal testing only — production secret keys are rejected
                    by api-dev. Persisted to .env as SOLVAPAY_API_BASE_URL.

Flags for doctor:
  --dev             Target the SolvaPay dev backend (api-dev.solvapay.com)
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

function parseDoctorArgs(argv: string[]): { dev: boolean } {
  let dev = false
  for (const arg of argv) {
    if (arg === '--dev') {
      dev = true
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown doctor flag: ${arg}`)
    }
  }
  return { dev }
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

  if (command === 'doctor') {
    printVersionBanner()
    await runDoctorCommand(parseDoctorArgs(process.argv.slice(3)))
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
