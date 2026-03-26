import { runInitCommand } from './commands/init'

const HELP_TEXT = `SolvaPay CLI

Usage:
  solvapay <command>

Commands:
  init    Sign in and write SOLVAPAY_SECRET_KEY to .env
`

const main = async () => {
  const command = process.argv[2]

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${HELP_TEXT}\n`)
    return
  }

  if (command === 'init') {
    await runInitCommand()
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
