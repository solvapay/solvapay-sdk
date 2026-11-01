#!/usr/bin/env node
// `npx @solvapay/agents launch|connect …`: an agent pays a merchant that
// takes SolvaPay agent payments with an agent key its owner approved on their
// phone. Keys are saved one per merchant in ~/.solvapay/agents (mode 600).
//
//   launch claude <providerRef> --model-url <url> --model <id> [--api <url>] [-- <claude args>]
//       Connects first when no key is saved for the merchant, then starts
//       Claude Code on the merchant's model API, paying with the key. Its
//       settings are for that launch only.
//   connect start <providerRef> --client <hermes|claude-code> [--name Hermes] [--api <url>] [--mcp-url <url>]
//                 [--model-url <anthropic-compatible url> --model <id>]
//       Opens a connect request and prints the page and code for the owner.
//   connect finish <providerRef> [--timeout <seconds>]
//       Waits for the owner's answer and, once approved, saves the agent key
//       where the agent host reads it and adds the merchant's MCP server, its
//       model provider, or both.
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
