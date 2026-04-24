import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createSolvaPayMcpServer } from '@solvapay/mcp-sdk'
import type { SolvaPayMerchantBranding } from '@solvapay/mcp'
import { getMerchantCore, isErrorResult } from '@solvapay/server'
import {
  mcpAssetOrigins,
  mcpPublicBaseUrl,
  solvaPay,
  solvapayApiOrigin,
  solvapayProductRef,
} from './config'
import { demoToolsEnabled, registerDemoTools } from './demo-tools'

const DIST_DIR = import.meta.filename.endsWith('.ts')
  ? path.join(import.meta.dirname, '../dist')
  : import.meta.dirname

const RESOURCE_URI = 'ui://mcp-checkout-app/mcp-app.html'

/**
 * Pre-fetch the merchant branding so every MCP `initialize` handshake
 * advertises the merchant's name + icon on the chrome strip instead of
 * a generic SolvaPay identity. Silent on failure — the server still
 * boots with the default `solvapay-mcp-server` name and a bare
 * `tools/list`. Call once at startup and pass the result to
 * `createServer`.
 */
export async function fetchBranding(): Promise<SolvaPayMerchantBranding | undefined> {
  try {
    // `getMerchantCore` expects a Web Request but only reads auth
    // context from it — a minimal synthetic GET satisfies the
    // signature without any cookie / header requirements for
    // server-to-server merchant lookups.
    const request = new Request('https://local/merchant', { method: 'GET' })
    const result = await getMerchantCore(request, { solvaPay })
    if (isErrorResult(result)) return undefined
    // `iconUrl` is a forward-looking field on the merchant DTO (see
    // provider branding roadmap). Read it defensively so this example
    // keeps compiling against older SDK type builds that ship with a
    // landscape-only `logoUrl`.
    const iconUrl = (result as { iconUrl?: string }).iconUrl
    return {
      brandName: result.displayName,
      iconUrl,
      logoUrl: result.logoUrl,
    }
  } catch {
    return undefined
  }
}

/**
 * Canonical "hello world" SolvaPay MCP server.
 *
 * `createSolvaPayMcpServer` handles every transport + bootstrap tool, the
 * UI resource, and the Stripe CSP baseline. Integrators who want extra
 * paywall-protected tools drop into `additionalTools` — everything else
 * stays declarative.
 *
 * When `DEMO_TOOLS` is unset (or not `"false"`), two paywalled demo
 * tools (`search_knowledge`, `get_market_quote`) + their slash-command
 * prompts land on the server so the paywall flow can be exercised from
 * `basic-host` without hand-rolling a gated tool. See
 * `examples/mcp-checkout-app/src/demo-tools.ts`.
 */
export function createServer(branding?: SolvaPayMerchantBranding): McpServer {
  // Allow the merchant logo + other provider-served assets to load from
  // the SolvaPay API origin + any extra origins declared via
  // `MCP_ASSET_ORIGINS` (typically `http://localhost:<port>` in dev).
  // Goes through `resource_domains` because `img-src` / `style-src`
  // live there; `connect_domains` would only help for `fetch()` /
  // `XHR`, not `<img>` tags.
  const resourceDomains = Array.from(
    new Set([solvapayApiOrigin, ...mcpAssetOrigins]),
  )

  const server = createSolvaPayMcpServer({
    solvaPay,
    productRef: solvapayProductRef,
    resourceUri: RESOURCE_URI,
    htmlPath: path.join(DIST_DIR, 'mcp-app.html'),
    publicBaseUrl: mcpPublicBaseUrl,
    csp: {
      connectDomains: [solvapayApiOrigin],
      resourceDomains,
    },
    branding,
    additionalTools: demoToolsEnabled() ? registerDemoTools : undefined,
    onToolCall: (name, args) => {
      if (process.env.SOLVAPAY_DEBUG === 'true') {
        console.error(`[mcp-checkout-app] -> ${name}`, args)
      }
    },
    onToolResult: (name, result, { durationMs }) => {
      if (process.env.SOLVAPAY_DEBUG === 'true') {
        const status = result.isError ? 'ERROR' : 'ok'
        console.error(`[mcp-checkout-app] <- ${name} ${status} in ${durationMs}ms`)
      }
    },
  })

  if (process.env.SOLVAPAY_DEBUG === 'true') {
    // Deliberate escape hatch into `@modelcontextprotocol/sdk`'s private
    // `_registeredTools` bag so `SOLVAPAY_DEBUG=true` can dump the
    // effective `tools/list` descriptor shape (`_meta.ui.resourceUri`,
    // icons, annotations) without routing through an actual `tools/list`
    // request. Used for diagnosing host-specific paywall/widget opens —
    // mirrors the same private-field access pattern the mcp-sdk unit
    // tests rely on. NOT a public helper; the MCP SDK reserves the
    // right to rename this field, at which point this block breaks
    // loudly (typeof undefined) and we adjust.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registered = (server as any)._registeredTools as
      | Record<string, { _meta?: unknown; annotations?: unknown }>
      | undefined
    if (registered) {
      for (const name of Object.keys(registered)) {
        const t = registered[name]
        console.error(`[mcp-checkout-app] descriptor ${name}`, {
          _meta: t._meta,
          annotations: t.annotations,
        })
      }
    }
  }

  return server
}
