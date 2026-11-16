/** What the TypeScript parity servers share: settings from ../.env, and the tool. */
import path from 'node:path'
import { config } from 'dotenv'

const HERE = import.meta.dirname
config({ path: path.join(HERE, '..', '.env'), quiet: true })

/** A setting from ../.env; a missing one stops the server. */
export function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. See examples/mcp-parity/README.md.`)
  return value
}

/**
 * The widget every SDK ships, built once by mcp-app/. The Python package's
 * copy is used so all the servers serve the same bytes without a build.
 */
export const WIDGET = path.join(HERE, '../../../python/src/solvapay/mcp/mcp-app.html')

/** A made-up price from the symbol, the same in every language. */
export function quote(symbol: string, server: string) {
  const upper = symbol.toUpperCase()
  let sum = 0
  for (const char of upper) sum += char.charCodeAt(0)
  return { symbol: upper, price: 100 + (sum % 900), currency: 'USD', server }
}

/** What an agent's call to get_quote may cost, and what it is charged. */
export const AGENT_ESTIMATE = { amount: '0.01', currency: 'USD' }
export const AGENT_COST = { amount: 0.005, currency: 'USD' }
