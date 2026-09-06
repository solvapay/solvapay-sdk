/**
 * Single-source invariant for the LLM-facing intent-tool names.
 *
 * `MCP_TOOL_NAMES` owns the strings. `VIEWER_TOOL_NAME`, `TOOL_FOR_VIEW`,
 * and the scaffolder's `INTENT_TOOLS` arrays must derive from (or match)
 * that list — a rename that only edits one of them is a silent desync.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  INTENT_TOOL_NAMES,
  MCP_TOOL_NAMES,
  NARRATORS,
  TOOL_FOR_VIEW,
  VIEWER_TOOL_NAME,
  buildSolvaPayPrompts,
} from '../src'
import type { BootstrapPayload } from '../src'

const SCAFFOLDER_SCRIPTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'create-solvapay',
  'templates',
  'mcp',
  '_base',
  'scripts',
)

function extractIntentTools(source: string, file: string): string[] {
  const match = source.match(/INTENT_TOOLS\s*=\s*(?:new Set\()?\[([^\]]+)\]/)
  if (!match) {
    throw new Error(`${file} has no INTENT_TOOLS array to keep in sync with MCP_TOOL_NAMES`)
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map(capture => capture[1]).sort()
}

describe('INTENT_TOOL_NAMES', () => {
  it('is the viewer plus activate_plan', () => {
    expect([...INTENT_TOOL_NAMES].sort()).toEqual(
      [VIEWER_TOOL_NAME, MCP_TOOL_NAMES.activatePlan].sort(),
    )
  })

  it('drives TOOL_FOR_VIEW so every surface maps to the viewer', () => {
    expect(TOOL_FOR_VIEW).toEqual({
      checkout: VIEWER_TOOL_NAME,
      account: VIEWER_TOOL_NAME,
      topup: VIEWER_TOOL_NAME,
    })
    expect(Object.values(TOOL_FOR_VIEW).every(name => name === VIEWER_TOOL_NAME)).toBe(true)
  })

  it('does not keep the collapsed viewer names as tools', () => {
    const names = Object.values(MCP_TOOL_NAMES)
    expect(names).not.toContain('upgrade')
    expect(names).not.toContain('manage_account')
    expect(names).not.toContain('topup')
  })
})

describe('scaffolder INTENT_TOOLS arrays', () => {
  it.each(['verify.mjs', 'test.mjs'] as const)('%s matches INTENT_TOOL_NAMES', file => {
    const source = readFileSync(join(SCAFFOLDER_SCRIPTS_DIR, file), 'utf8')
    expect(extractIntentTools(source, file)).toEqual([...INTENT_TOOL_NAMES].sort())
  })
})

/**
 * Tool names the prose actually tells the model to invoke. View
 * literals (`view: "topup"`, `` `view`: `topup` ``) and slash-prompt
 * names are not invocations.
 */
function invokedToolNames(text: string): string[] {
  return [
    ...text.matchAll(/call(?: the)? `([a-z][a-z0-9_]*)`/gi),
    ...text.matchAll(/`([a-z][a-z0-9_]*)` tool/gi),
  ].map(m => m[1])
}

const LIVE_CATALOGUE = new Set<string>([
  ...Object.values(MCP_TOOL_NAMES),
  ...INTENT_TOOL_NAMES,
])

describe('prose names only live catalogue tools', () => {
  const payload = {
    product: { name: 'Wiki' },
    portalUrl: 'https://example.test/manage',
    checkoutUrl: 'https://example.test/checkout',
    plans: [{ name: 'Pro', requiresPayment: true, price: 1000, currency: 'USD' }],
    customer: {
      purchase: {
        purchases: [{ planSnapshot: { name: 'Pro', price: 1000, currency: 'USD' } }],
      },
    },
  } as unknown as BootstrapPayload

  it('narrator output does not name a tool absent from the catalogue', () => {
    for (const narrate of Object.values(NARRATORS)) {
      const { text } = narrate(payload)
      for (const name of invokedToolNames(text)) {
        expect(LIVE_CATALOGUE.has(name), `\`${name}\` in narrator output`).toBe(true)
      }
    }
  })

  it('example demo-tools prose does not invoke a retired tool name', () => {
    const files = [
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        'examples',
        'mcp-checkout-app',
        'src',
        'demo-tools.ts',
      ),
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        'examples',
        'cloudflare-workers-mcp',
        'src',
        'demo-tools.ts',
      ),
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        'examples',
        'supabase-edge-mcp',
        'supabase',
        'functions',
        'mcp',
        'demo-tools.ts',
      ),
    ]
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const name of invokedToolNames(source)) {
        if (name === 'search_knowledge' || name === 'get_market_quote' || name === 'query_sales_trends') {
          continue
        }
        if (name.startsWith('predict_')) continue
        expect(LIVE_CATALOGUE.has(name), `\`${name}\` in ${file}`).toBe(true)
      }
    }
  })

  it('prompt user messages do not name a tool absent from the catalogue', async () => {
    const prompts = buildSolvaPayPrompts()
    for (const prompt of prompts) {
      const result = await prompt.handler({})
      for (const msg of result.messages) {
        for (const name of invokedToolNames(msg.content.text)) {
          expect(LIVE_CATALOGUE.has(name), `\`${name}\` in prompt ${prompt.name}`).toBe(true)
        }
      }
    }
  })
})
