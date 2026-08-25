import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFixture } from '../lib/fixture-schema.js'
import { lookupPath } from '../../shared/repo-paths.js'
import { createDefaultMcpAdapterRegistry, runMcpAuthoringFixture } from './replay.js'
import { parseMcpAuthoringFixture } from './scenario-schema.js'

function discoverFixtureFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...discoverFixtureFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(full)
    }
  }
  return files.sort()
}

const MCP_AUTHORING_FIXTURES = [
  'allow/respond-emitted-blocks.json',
  'allow/respond-key-order.json',
  'allow/respond-minimal.json',
  'allow/respond-nudge.json',
  'allow/respond-text-option.json',
  'customer-ref/from-hook.json',
  'customer-ref/from-tool-args.json',
  'error/handler-throws.json',
  'gate/activation-required.json',
  'gate/handler-invoked.json',
  'gate/payment-required.json',
] as const

describe('MCP-authoring fixtures', () => {
  const root = lookupPath('mcpFixtures')
  const files = discoverFixtureFiles(root)
  const relative = files.map(file => path.relative(root, file).split(path.sep).join('/'))

  it('discovers the frozen fixture list', () => {
    expect(relative).toEqual([...MCP_AUTHORING_FIXTURES])
  })

  it.each(MCP_AUTHORING_FIXTURES)('replays %s through registerPayable', async rel => {
    const raw: unknown = JSON.parse(readFileSync(path.join(root, rel), 'utf8'))
    const fixture = parseFixture(raw)
    const registry = createDefaultMcpAdapterRegistry()
    const [binding] = registry.get(fixture.input.fn)
    if (binding === undefined) {
      throw new Error(`no binding for ${fixture.input.fn}`)
    }
    await binding.invoke(fixture)
  })

  it.each([
    'gate/payment-required.json',
    'gate/activation-required.json',
    'gate/handler-invoked.json',
  ] as const)(
    'fails %s when formatGate is adapter-authored instead of native paywallToolResult',
    async rel => {
      const raw: unknown = JSON.parse(readFileSync(path.join(root, rel), 'utf8'))
      const fixture = parseFixture(raw)
      const { observation } = parseMcpAuthoringFixture(fixture)
      const { toolResult } = await runMcpAuthoringFixture(fixture, {
        formatGate: 'adapter-authored',
      })
      expect(toolResult).toMatchObject({
        content: [{ type: 'text', text: 'adapter-authored' }],
      })
      expect(toolResult).not.toEqual(observation.toolResult)
    },
  )
})
