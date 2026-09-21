import { runDoctorCommand } from './commands/doctor'
import { runInitCommand } from './commands/init'
import { parseDoctorArgs, parseInitArgs } from './parse-args'
import { PACKAGE_VERSION, printVersionBanner } from './version-banner'

const HELP_TEXT = `SolvaPay CLI

Usage:
  solvapay <command> [flags]

Commands:
  init    Authenticate, configure .env, and install SolvaPay SDK packages
  doctor  Verify secret key, API URL, product ref, and product readiness

Flags for init:
  -y, --yes         Auto-create package.json (TypeScript) and skip browser confirmation
  --language <id>   Override language detection (ts, python, ruby, go, rust)
  --product <ref>   Verify and persist SOLVAPAY_PRODUCT_REF without product picker
  --dev             Target the SolvaPay dev backend (api-dev.solvapay.com).
                    Internal testing only — production secret keys are rejected
                    by api-dev. Persisted to .env as SOLVAPAY_API_BASE_URL.
  --api-base <url>  Override the API origin. Wins over --dev and
                    SOLVAPAY_API_BASE_URL. Use with --dev to keep checkout
                    path deps while talking to a local stack.

Flags for doctor:
  --dev             Target the SolvaPay dev backend (api-dev.solvapay.com)
  --api-base <url>  Override the API origin (same precedence as init)
`

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
    const initArgs = parseInitArgs(process.argv.slice(3))
    if (initArgs.help) {
      process.stdout.write(`${HELP_TEXT}\n`)
      return
    }
    printVersionBanner()
    await runInitCommand(initArgs)
    return
  }

  if (command === 'doctor') {
    const doctorArgs = parseDoctorArgs(process.argv.slice(3))
    if (doctorArgs.help) {
      process.stdout.write(`${HELP_TEXT}\n`)
      return
    }
    printVersionBanner()
    await runDoctorCommand(doctorArgs)
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
