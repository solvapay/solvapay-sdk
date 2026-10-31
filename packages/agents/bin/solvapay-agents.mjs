#!/usr/bin/env node
// `npx @solvapay/agents connect …`: an agent connects itself to a merchant
// that takes SolvaPay agent payments, and its owner approves on their phone.
//
//   connect start <providerRef> --client hermes [--name Hermes] [--api <url>] [--mcp-url <url>]
//       Opens a connect request and prints the page and code for the owner.
//   connect finish <providerRef> [--timeout <seconds>]
//       Waits for the owner's answer and, once approved, saves the agent key
//       where the agent host reads it and adds the merchant's MCP server.
//
// The key never goes to stdout: the model reading this output never sees it.
import { main } from '../src/connect.mjs'

main(process.argv.slice(2)).then(
  code => process.exit(code),
  error => {
    console.error(`solvapay-agents: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  },
)
