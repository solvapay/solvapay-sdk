/**
 * The agents server in TypeScript. One /mcp serves two kinds of caller:
 *
 * - An agent presenting a SolvaPay agent token or agent key goes to the agent
 *   route. Each get_quote call is authorized by SolvaPay first (spend policy,
 *   budget, balance, and the owner's approval when asked), then completed at
 *   the cost it reports.
 * - Everyone else goes to the legacy paywall server behind it, as in
 *   paywall.ts.
 *
 *   pnpm agents      # http://127.0.0.1:3070/mcp
 */
import { readFile } from 'node:fs/promises'
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
import { createSolvaPayMcpFetch } from '@solvapay/mcp/fetch'
import { createSolvaPay, createSolvaPayClient } from '@solvapay/server'
import { serveFetch } from './serve-fetch'
import { AGENT_COST, AGENT_ESTIMATE, quote, required, WIDGET } from './shared'

const PORT = 3070
const secretKey = required('SOLVAPAY_SECRET_KEY')
const apiBaseUrl = required('SOLVAPAY_API_BASE_URL')
const productRef = required('SOLVAPAY_PRODUCT_REF')
const providerRef = required('SOLVAPAY_PROVIDER_REF')
const issuer = required('SOLVAPAY_AGENT_ISSUER')
const jwksUrl = required('SOLVAPAY_AGENT_JWKS_URL')
const publicBaseUrl = required('AGENTS_TS_URL')
const maxWaitSeconds = Number(required('APPROVAL_WAIT_SECONDS'))
const agentOAuth = required('AGENT_OAUTH')
if (agentOAuth !== 'on' && agentOAuth !== 'off') throw new Error('AGENT_OAUTH must be on or off')
const mcpResource = `${publicBaseUrl}/mcp`
const widgetHtml = await readFile(WIDGET, 'utf8')

const log: Logger = {
  info: (event, fields) => console.error(JSON.stringify({ event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ event, ...fields })),
}
const agentClient = createSolvaPayAgentClient({ apiBaseUrl, secretKey })
const environment = secretKeyEnvironment(secretKey)

// Customers: the legacy paywall server, as in paywall.ts.
const customers = createSolvaPayMcpFetch({
  solvaPay: createSolvaPay({ apiClient: createSolvaPayClient({ apiKey: secretKey, apiBaseUrl }) }),
  productRef,
  publicBaseUrl,
  apiBaseUrl,
  readHtml: async () => widgetHtml,
  resourceUri: 'ui://mcp-parity/mcp-app.html',
  serverName: 'agents-typescript',
  additionalTools: ({ registerPayable }) => {
    registerPayable('get_quote', {
      title: 'Get quote',
      description: 'A made-up price for a ticker symbol. One unit per call.',
      schema: { symbol: z.string().min(1).max(8) },
      handler: async ({ symbol }, ctx) => ctx.respond(quote(symbol, 'typescript')),
    })
  },
})

// Agents: verified, then each call authorized and completed by SolvaPay.
const agents = createAgentMcpRoute({
  issuer,
  agentLayer: createAgentLayer({
    verifyAgentToken: createAgentTokenVerifier({
      issuer,
      providerRef,
      environment,
      // A host that signed in by OAuth holds a token for this resource.
      ...(agentOAuth === 'on' ? { resource: mcpResource } : {}),
      keys: createRemoteJWKSet(new URL(jwksUrl)),
    }),
    verifyAgentKey: createAgentKeyVerifier({ client: agentClient, environment }),
  }),
  calls: createAgentCalls({ client: agentClient, maxWaitSeconds, log }),
  log,
  mcpPath: '/mcp',
  serverName: 'agents-typescript',
  ...(agentOAuth === 'on' ? { protectedResource: { resource: mcpResource } } : {}),
  tools: (_server, paid) =>
    paid<{ symbol: string }>({
      name: 'get_quote',
      title: 'Get quote',
      description: `A made-up price for a ticker symbol. Up to ${AGENT_ESTIMATE.amount} ${AGENT_ESTIMATE.currency} per call.`,
      inputSchema: { symbol: z.string().min(1).max(8) },
      item: () => 'get_quote',
      estimate: () => AGENT_ESTIMATE,
      prompt: ({ symbol }) => symbol,
      run: async ({ symbol }) => ({
        status: 200,
        cost: AGENT_COST,
        result: { content: [{ type: 'text', text: JSON.stringify(quote(symbol, 'typescript')) }] },
      }),
    }),
})

serveFetch(
  PORT,
  async request => (await agents(request)) ?? customers(request),
  () =>
    console.error(
      `[agents-ts] http://127.0.0.1:${PORT}/mcp, public ${mcpResource}, agent OAuth ${agentOAuth}`,
    ),
)
