/**
 * Single-source invariant for the four LLM-facing intent-tool names.
 *
 * `MCP_TOOL_NAMES` owns the strings. `IntentTool`, `TOOL_FOR_VIEW`, and
 * the scaffolder's `INTENT_TOOLS` arrays must derive from (or match)
 * that list — a rename that only edits one of them is a silent desync.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { INTENT_TOOL_NAMES, MCP_TOOL_NAMES, TOOL_FOR_VIEW } from '../src'

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
  it('is exactly the four MCP_TOOL_NAMES intent entries', () => {
    expect([...INTENT_TOOL_NAMES].sort()).toEqual(
      [
        MCP_TOOL_NAMES.upgrade,
        MCP_TOOL_NAMES.manageAccount,
        MCP_TOOL_NAMES.topup,
        MCP_TOOL_NAMES.activatePlan,
      ].sort(),
    )
  })

  it('drives TOOL_FOR_VIEW so a rename cannot leave a stale literal', () => {
    expect(TOOL_FOR_VIEW).toEqual({
      checkout: MCP_TOOL_NAMES.upgrade,
      account: MCP_TOOL_NAMES.manageAccount,
      topup: MCP_TOOL_NAMES.topup,
    })
    expect(Object.values(TOOL_FOR_VIEW).every(name => INTENT_TOOL_NAMES.includes(name))).toBe(
      true,
    )
  })
})

describe('scaffolder INTENT_TOOLS arrays', () => {
  it.each(['verify.mjs', 'test.mjs'] as const)(
    '%s matches INTENT_TOOL_NAMES',
    file => {
      const source = readFileSync(join(SCAFFOLDER_SCRIPTS_DIR, file), 'utf8')
      expect(extractIntentTools(source, file)).toEqual([...INTENT_TOOL_NAMES].sort())
    },
  )
})
