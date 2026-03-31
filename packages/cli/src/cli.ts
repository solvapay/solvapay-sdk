import { runInitCommand } from './commands/init'

const HELP_TEXT = `SolvaPay CLI

Usage:
  solvapay <command> [flags]

Commands:
  init    Authenticate, configure .env, and install SolvaPay SDK packages

Flags for init:
  -y, --yes    Auto-create package.json and skip browser confirmation prompt
`

const main = async () => {
  const command = process.argv[2]

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${HELP_TEXT}\n`)
    return
  }

  if (command === 'init') {
    const initFlags = new Set(process.argv.slice(3))
    const yes = initFlags.has('--yes') || initFlags.has('-y')
    await runInitCommand({ yes })
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
