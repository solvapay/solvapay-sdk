import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { callNativeSync } from '@solvapay/server'
import { installNativeMcpApi } from '@solvapay/mcp-core'

installNativeMcpApi({ callNativeSync })
import { parseFixture } from '../lib/fixture-schema.js'
import { lookupPath } from '../../shared/repo-paths.js'
import { createDefaultMcpAdapterRegistry, runMcpAuthoringFixture } from './replay.js'
import { parseMcpAuthoringFixture } from './scenario-schema.js'
import { replayMcpCoreFixture } from './core-replay.js'

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
  'auth-gate/allow-initialize.json',
  'auth-gate/allow-tools-call-with-bearer.json',
  'auth-gate/challenge-tools-call.json',
  'bootstrap/unauthenticated.json',
  'builtin-tools/activate-plan-no-ref.json',
  'builtin-tools/activate-plan.json',
  'builtin-tools/attach-business-details-unauth.json',
  'builtin-tools/attach-business-details.json',
  'builtin-tools/cancel-renewal-unauth.json',
  'builtin-tools/cancel-renewal.json',
  'builtin-tools/create-checkout-session-unauth.json',
  'builtin-tools/create-checkout-session.json',
  'builtin-tools/create-customer-session-unauth.json',
  'builtin-tools/create-customer-session.json',
  'builtin-tools/create-payment-intent-unauth.json',
  'builtin-tools/create-payment-intent.json',
  'builtin-tools/create-topup-payment-intent-unauth.json',
  'builtin-tools/create-topup-payment-intent.json',
  'builtin-tools/manage-account.json',
  'builtin-tools/process-payment-unauth.json',
  'builtin-tools/process-payment.json',
  'builtin-tools/reactivate-renewal-unauth.json',
  'builtin-tools/reactivate-renewal.json',
  'builtin-tools/topup.json',
  'builtin-tools/upgrade.json',
  'config-log/once.json',
  'csp/default.json',
  'csp/with-api-origin.json',
  'customer-ref/from-hook.json',
  'customer-ref/from-tool-args.json',
  'dcr/generic-reject.json',
  'dcr/unresolved-product.json',
  'descriptors/default-all-views.json',
  'descriptors/views-checkout-only.json',
  'dispatch/challenge.json',
  'dispatch/invoke-handler.json',
  'dispatch/rpc.json',
  'engine/gate-denied.json',
  'engine/initialize.json',
  'engine/invoke-handler.json',
  'engine/tools-list.json',
  'error/handler-throws.json',
  'gate/activation-required.json',
  'gate/handler-invoked.json',
  'gate/payment-required.json',
  'hide-tools/bypass-chatgpt.json',
  'hide-tools/filter-ui-audience.json',
  'narrate/activate-plan.json',
  'narrate/manage-account-active.json',
  'narrate/manage-account.json',
  'narrate/mode-auto.json',
  'narrate/mode-text.json',
  'narrate/mode-ui.json',
  'narrate/placeholder.json',
  'narrate/topup.json',
  'narrate/upgrade.json',
  'oauth-proxy/authorize.json',
  'oauth-proxy/discovery-authorization-server.json',
  'oauth-proxy/discovery-post-405.json',
  'oauth-proxy/discovery-protected-resource.json',
  'oauth-proxy/openid-404.json',
  'oauth-proxy/paths-override.json',
  'oauth-proxy/register-502.json',
  'oauth-proxy/token-502.json',
  'oauth/discovery-authorization-server.json',
  'oauth/discovery-protected-resource-mcp-path.json',
  'oauth/discovery-protected-resource.json',
  'oauth/normalize-nestjs-401.json',
  'oauth/normalize-rfc-passthrough.json',
  'overview/resource.json',
]

const REGISTER_PAYABLE_FIXTURES = MCP_AUTHORING_FIXTURES.filter(rel =>
  ['allow/', 'customer-ref/', 'error/', 'gate/'].some(prefix => rel.startsWith(prefix)),
)

describe('MCP-authoring fixtures', () => {
  const root = lookupPath('mcpFixtures')
  const files = discoverFixtureFiles(root)
  const relative = files.map(file => path.relative(root, file).split(path.sep).join('/'))

  it('discovers the frozen fixture list', () => {
    expect(relative).toEqual([...MCP_AUTHORING_FIXTURES])
  })

  it.each(REGISTER_PAYABLE_FIXTURES)('replays %s through registerPayable', async rel => {
    const raw: unknown = JSON.parse(readFileSync(path.join(root, rel), 'utf8'))
    const fixture = parseFixture(raw)
    const registry = createDefaultMcpAdapterRegistry()
    const [binding] = registry.get(fixture.input.fn)
    if (binding === undefined) {
      throw new Error(`no binding for ${fixture.input.fn}`)
    }
    await binding.invoke(fixture)
  })

  it.each(MCP_AUTHORING_FIXTURES.filter(rel => !REGISTER_PAYABLE_FIXTURES.includes(rel)))(
    'replays %s through MCP core ops',
    async rel => {
      const raw: unknown = JSON.parse(readFileSync(path.join(root, rel), 'utf8'))
      const fixture = parseFixture(raw)
      await replayMcpCoreFixture(fixture, raw, rel)
    },
  )

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
