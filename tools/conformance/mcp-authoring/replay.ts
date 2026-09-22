/**
 * Replay MCP-authoring fixtures against the TypeScript reference adapter.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect } from 'vitest'
import { installNativeCoreApi } from '@solvapay/core'
import { installNativeMcpApi } from '@solvapay/mcp-core'
import { callNativeSync } from '@solvapay/server'
import type { PaywallStructuredContent, PaywallToolResult } from '@solvapay/server'
import type { Fixture } from '../lib/fixture-schema.js'
import { dirPath } from '../../shared/repo-paths.js'
import { callRegisteredPayable } from './mcp-adapter-driver.js'
import { createMockBackend, projectUsage } from './mock-backend.js'
import { parseMcpAuthoringFixture } from './scenario-schema.js'

export type McpAdapterBinding = {
  id: string
  invoke: (fixture: Fixture) => Promise<void>
}

export class McpAdapterRegistry {
  private readonly bindings = new Map<string, McpAdapterBinding[]>()

  register(fn: string, binding: McpAdapterBinding): void {
    const list = this.bindings.get(fn) ?? []
    list.push(binding)
    this.bindings.set(fn, list)
  }

  get(fn: string): McpAdapterBinding[] {
    const list = this.bindings.get(fn)
    if (!list || list.length === 0) {
      throw new Error(`No MCP adapter binding registered for fn: ${fn}`)
    }
    return list
  }
}

type McpAdapterNative = {
  installMcpAdapterNative: (api: {
    formatGate: (gate: PaywallStructuredContent) => PaywallToolResult
  }) => void
  resetMcpAdapterNativeForTests: () => void
}

type NativeDecisions = {
  installNativeDecisionApi: (api: { callNativeSync: typeof callNativeSync }) => void
}

async function loadServerInternals(): Promise<{
  mcp: McpAdapterNative
  decisions: NativeDecisions
}> {
  const root = dirPath('sdksTypescript')
  const mcpHref = pathToFileURL(path.join(root, 'server/src/adapters/mcp.ts')).href
  const decisionsHref = pathToFileURL(path.join(root, 'server/src/native-decisions.ts')).href
  const mcp = (await import(mcpHref)) as McpAdapterNative
  const decisions = (await import(decisionsHref)) as NativeDecisions
  return { mcp, decisions }
}

export type FormatGateMode = 'native' | 'none' | 'adapter-authored'

let installedMode: FormatGateMode | null = null

export async function installMcpAuthoringNatives(
  options: { formatGate?: FormatGateMode } = {},
): Promise<void> {
  const formatGate = options.formatGate ?? 'native'
  if (installedMode === formatGate) {
    return
  }
  const { mcp, decisions } = await loadServerInternals()
  decisions.installNativeDecisionApi({ callNativeSync })
  installNativeCoreApi({ callNativeSync })
  installNativeMcpApi({ callNativeSync })
  if (formatGate === 'native') {
    mcp.installMcpAdapterNative({
      formatGate: (gate: PaywallStructuredContent): PaywallToolResult =>
        callNativeSync(
          'paywallToolResult',
          JSON.stringify({ message: gate.message, structuredContent: gate }),
        ) as PaywallToolResult,
    })
  } else if (formatGate === 'adapter-authored') {
    mcp.installMcpAdapterNative({
      formatGate: (): PaywallToolResult => ({
        content: [{ type: 'text', text: 'adapter-authored' }],
        isError: false,
        structuredContent: { kind: 'payment_required' },
      }),
    })
  } else {
    mcp.resetMcpAdapterNativeForTests()
  }
  installedMode = formatGate
}

export async function runMcpAuthoringFixture(
  fixture: Fixture,
  options: { formatGate?: FormatGateMode } = {},
): Promise<{ toolResult: unknown; usage: ReturnType<typeof projectUsage> }> {
  await installMcpAuthoringNatives(options)
  const { scenario } = parseMcpAuthoringFixture(fixture)
  const backend = createMockBackend(scenario.limits)
  const toolResult = await callRegisteredPayable(backend.client, scenario)
  return { toolResult, usage: projectUsage(backend.trackUsageCalls) }
}

export async function replayMcpAuthoringFixture(
  fixture: Fixture,
  options: { formatGate?: FormatGateMode } = {},
): Promise<void> {
  const { observation } = parseMcpAuthoringFixture(fixture)
  const observed = await runMcpAuthoringFixture(fixture, options)
  expect(observed.toolResult).toEqual(observation.toolResult)
  expect(observed.usage).toEqual(observation.usage)
}

export function createDefaultMcpAdapterRegistry(): McpAdapterRegistry {
  const registry = new McpAdapterRegistry()
  registry.register('registerPayable', {
    id: 'typescript',
    invoke: replayMcpAuthoringFixture,
  })
  return registry
}
