import { isPreviewBuild } from '@solvapay/init'
import { parseInitArgs, parseVerifyArgs } from './args'
import { runDoctorCommand } from './commands/doctor'
import { runInitCommand } from './commands/init'
import { runVerifyCommand } from './commands/verify'
import { main as runAgentCommand } from './agent/index'
import { PACKAGE_VERSION, printVersionBanner } from './version-banner'

const HELP_TEXT = `SolvaPay CLI

Usage:
  solvapay <command> [flags]

Commands:
  init     Authenticate, configure .env, and install the SolvaPay SDK
           (TypeScript, Python or Go, detected from the project files)
  doctor   Verify secret key, API URL, product ref, product readiness, and that
           the project's SolvaPay SDK is the newest release (npm, PyPI or Go)
  verify   Check a running SolvaPay MCP server in any language:
           verify <server url> [--credentials-file <path>]
  launch   (preview) Start Claude Code or Hermes on a merchant, paying with an
           agent key its owner approved: launch <claude|hermes> <merchant> [-- <agent args>]
  connect  (preview) For an agent connecting itself: connect <merchant> --client <claude|hermes>,
           run again until it says connected (the first run asks the owner).
           Agent payments run in sandbox with test money for now.

Flags for init:
  -y, --yes             Skip prompts (the browser confirmation and the project
                        language question). Never creates a package.json unless
                        --language ts is passed.
  --language <lang>     ts, python or go. Needed when the folder has files for
                        two languages, or none, and no one is at a terminal.
                        Detected from go.mod, uv.lock, poetry.lock,
                        pyproject.toml, requirements.txt or package.json.
  --features <list>     What you use SolvaPay for: mcp, agents, web (comma
                        separated). Python extras, or extra npm packages.
  --product <ref>       Verify and persist SOLVAPAY_PRODUCT_REF without product picker
  --dev                 Target the SolvaPay dev backend (api-dev.solvapay.com).
                        Internal testing only — production secret keys are rejected
                        by api-dev. Persisted to .env as SOLVAPAY_API_BASE_URL.

Flags for doctor:
  --dev                 Target the SolvaPay dev backend (api-dev.solvapay.com)

Flags for verify:
  --credentials-file <path>  JSON file with an "accessToken" for the server, to
                             also check the paywall gate and the account tool
`

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
    // A preview CLI installs preview SDKs; a stable one, stable SDKs.
    await runInitCommand({
      ...parseInitArgs(process.argv.slice(3)),
      ...(isPreviewBuild(PACKAGE_VERSION) ? { preview: true } : {}),
    })
    return
  }

  if (command === 'doctor') {
    printVersionBanner()
    await runDoctorCommand(parseDoctorArgs(process.argv.slice(3)))
    return
  }

  // No banner: the output is one JSON document.
  if (command === 'verify') {
    await runVerifyCommand(parseVerifyArgs(process.argv.slice(3)))
    return
  }

  // No banner: an agent reads this output, and the launcher decides what reaches stdout.
  if (command === 'launch' || command === 'connect') {
    process.exitCode = await runAgentCommand(process.argv.slice(2), {
      npx: PACKAGE_VERSION.includes('-preview') ? 'npx solvapay@preview' : 'npx solvapay',
    })
    return
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP_TEXT}\n`)
  process.exitCode = 1
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  process.stderr.write(`solvapay: ${message}\n`)
  process.exitCode = 1
})
