# @solvapay/agents

[![npm version](https://img.shields.io/npm/v/@solvapay/agents.svg)](https://www.npmjs.com/package/@solvapay/agents)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Let SolvaPay agents pay for your MCP tools and API endpoints. The package verifies the agent that is calling, asks SolvaPay to authorize each paid call before it runs, completes it at the cost your upstream reported, and reports usage. The spend policy, approvals, balance and settlement all run in SolvaPay. Your server never sees a card or a balance.

Guide: [Agent payments](https://docs.solvapay.com/sdks/typescript/guides/agents)

## Preview

Agent payments are a preview.

- SolvaPay turns them on per merchant. Until it does, SolvaPay refuses your server's requests with `feature_not_enabled`: paid calls are refused as `unavailable`, and agent key checks throw.
- Live agent payments aren't open yet. SolvaPay refuses live agents, live cards and live top-ups with `agent_live_disabled` for now. Build and test with a sandbox key (`sk_sandbox_…`) and sandbox agents, which pay with test money. When live opens, you switch to your production key and your code doesn't change.
- The API may change between preview releases.

## Install

```bash
npm install @solvapay/agents @modelcontextprotocol/server zod jose
```

`@modelcontextprotocol/server` (version 2) is an optional peer dependency, needed only for the MCP route. The package is ESM only. It imports `node:crypto`, so on Cloudflare Workers turn on the `nodejs_compat` flag.

| Import                     | What it gives you                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@solvapay/agents`         | The SolvaPay client, the agent token and agent key verifiers, `createAgentCalls`, and the OAuth helpers |
| `@solvapay/agents/mcp`     | `createAgentMcpRoute`, an MCP endpoint with paid tools                                                  |
| `@solvapay/agents/http`    | `createAgentHttpGate`, for paid endpoints in an HTTP API                                                |
| `@solvapay/agents/testing` | In-memory stand-ins for SolvaPay, for your tests                                                        |

You need your secret key, your provider reference (`prov_…`) and agent payments turned on for your merchant account.

## Example: a paid MCP tool

```typescript
import { createRemoteJWKSet } from 'jose'
import { z } from 'zod'
import {
  createAgentCalls,
  createAgentKeyVerifier,
  createAgentLayer,
  createAgentTokenVerifier,
  createSolvaPayAgentClient,
  secretKeyEnvironment,
  type Logger,
} from '@solvapay/agents'
import { createAgentMcpRoute } from '@solvapay/agents/mcp'

const secretKey = process.env.SOLVAPAY_SECRET_KEY! // sk_sandbox_… while live isn't open
const providerRef = process.env.SOLVAPAY_PROVIDER_REF!
const issuer = 'https://api.solvapay.com/v1/agent'

const log: Logger = {
  info: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ event, ...fields })),
}
const client = createSolvaPayAgentClient({ apiBaseUrl: 'https://api.solvapay.com', secretKey })
const environment = secretKeyEnvironment(secretKey)

const agents = createAgentMcpRoute({
  issuer,
  agentLayer: createAgentLayer({
    verifyAgentToken: createAgentTokenVerifier({
      issuer,
      providerRef,
      environment,
      keys: createRemoteJWKSet(new URL(`${issuer}/jwks.json`)),
    }),
    verifyAgentKey: createAgentKeyVerifier({ client, environment }),
  }),
  calls: createAgentCalls({ client, maxWaitSeconds: 50, log }),
  log,
  mcpPath: '/mcp',
  serverName: 'quotes',
  tools: (_server, paid) =>
    paid<{ symbol: string }>({
      name: 'get_quote',
      description: 'The latest price for a ticker symbol. Up to 0.01 USD per call.',
      inputSchema: { symbol: z.string().min(1).max(8) },
      item: () => 'get_quote',
      estimate: () => ({ amount: '0.01', currency: 'USD' }),
      prompt: ({ symbol }) => symbol,
      run: async ({ symbol }) => ({
        status: 200,
        cost: { amount: 0.005, currency: 'USD' },
        result: {
          content: [
            { type: 'text', text: JSON.stringify({ symbol: symbol.toUpperCase(), price: 182.5 }) },
          ],
        },
      }),
    }),
})

export default {
  async fetch(request: Request): Promise<Response> {
    return (await agents(request)) ?? new Response('Not found', { status: 404 })
  },
}
```

The route answers requests on your MCP path that carry a SolvaPay agent token or agent key, and returns `null` for everything else so your own handler can answer. The guide covers paid HTTP endpoints, refusals, approvals, usage reports and testing without SolvaPay.

## Links

- [Agent payments guide](https://docs.solvapay.com/sdks/typescript/guides/agents)
- [SolvaPay docs](https://docs.solvapay.com)
- The same package for [Python](https://docs.solvapay.com/sdks/python/guides/agents) and [Go](https://docs.solvapay.com/sdks/go/guides/agents)

## License

MIT
