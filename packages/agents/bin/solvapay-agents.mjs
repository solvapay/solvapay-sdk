#!/usr/bin/env node
// `npx @solvapay/agents launch|connect …` is now `npx solvapay launch|connect …`
// (the `solvapay` CLI). This bin stays for one release and runs the same code.
import { main } from 'solvapay/agent'

console.error('solvapay-agents: this command moved to the solvapay CLI. Run `npx solvapay ' + process.argv.slice(2).join(' ') + '` instead.')
main(process.argv.slice(2)).then(
  code => process.exit(code),
  error => {
    console.error(`solvapay: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  },
)
