// ---- @solvapay/agents: identity, OAuth helpers, prompt facts (suite `agent-identity`) ----
//
// Kept in its own file so the other agent suites can add their mappings
// without touching these. Operations: `verifyAgentTokens`, `promptFacts`,
// `oauthResources`. Scenario steps: `verifyAgentKey`, `identify`.
import {
  authChallenge,
  canonicalResource,
  createAgentKeyVerifier,
  createAgentLayer,
  createAgentTokenVerifier,
  createSolvaPayAgentClient,
  promptFacts,
  protectedResourceMetadata,
  protectedResourceMetadataPath,
  type AgentEnvironment,
  type AgentTokenResult,
  type Identification,
  type VerifiedAgent,
} from '@solvapay/agents'
import { createLocalJWKSet, type JSONWebKeySet } from 'jose'
import type { Implementation } from './operations'

const CONFORMANCE_API = 'https://api.conformance.test'

/**
 * The SDK's own refusal sentences. Any other detail comes from the JWT library
 * or the API's error text, which differ by language and are for people, so it
 * compares as a placeholder.
 */
const SDK_DETAILS = [
  /^cid is not a string$/,
  /^sub is not an agent reference$/,
  /^principal is missing$/,
  /^scope is not usage$/,
  /^env is not sandbox or live$/,
  /^This agent spends in (sandbox|live), and this secret key is for (sandbox|live)$/,
  /^.* cannot be an OAuth resource: no fragment or credentials$/,
]
const NOT_COMPARED = '<not compared>'

const comparableDetail = (detail: string): string =>
  SDK_DETAILS.some(pattern => pattern.test(detail)) ? detail : NOT_COMPARED

function agentOutcome(agent: VerifiedAgent): Record<string, unknown> {
  return {
    agentRef: agent.agentRef,
    principalRef: agent.principalRef,
    tokenId: agent.tokenId,
    expiresAt: agent.expiresAt?.toISOString(),
    promptExcerpt: agent.promptExcerpt,
    environment: agent.environment,
    clientId: agent.clientId,
  }
}

function tokenOutcome(result: AgentTokenResult): Record<string, unknown> {
  return result.ok
    ? { ok: true, agent: agentOutcome(result.agent) }
    : { ok: false, reason: result.reason, detail: comparableDetail(result.detail) }
}

function identificationOutcome(identification: Identification): Record<string, unknown> {
  if (identification.kind === 'agent') {
    return { kind: 'agent', agent: agentOutcome(identification.agent) }
  }
  if (identification.kind === 'rejected') {
    return {
      kind: 'rejected',
      reason: identification.reason,
      detail: comparableDetail(identification.detail),
    }
  }
  return { kind: identification.kind }
}

const environmentOf = (args: Record<string, unknown>): AgentEnvironment | undefined =>
  args.environment as AgentEnvironment | undefined

function tokenVerifier(args: Record<string, unknown>) {
  return createAgentTokenVerifier({
    issuer: args.issuer as string,
    providerRef: args.providerRef as string,
    resource: args.resource as string | undefined,
    environment: environmentOf(args),
    keys: createLocalJWKSet(args.jwks as JSONWebKeySet),
  })
}

/** Runs async `run` with `new Date()` and `Date.now()` reading `clock` (jose reads the time itself). */
async function atClockAsync<T>(clock: Date | undefined, run: () => Promise<T>): Promise<T> {
  if (clock === undefined) return run()
  const RealDate = Date
  const fixed = clock.getTime()
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed)
      else super(...(args as [string]))
    }
    static now(): number {
      return fixed
    }
  }
  globalThis.Date = FixedDate as DateConstructor
  try {
    return await run()
  } finally {
    globalThis.Date = RealDate
  }
}

/** Each of `tokens` (label → token) verified by one verifier, as label → outcome. */
async function verifyAgentTokens(
  args: Record<string, unknown>,
  clock: Date | undefined,
): Promise<unknown> {
  const verify = tokenVerifier(args)
  const out: Record<string, unknown> = {}
  for (const [label, token] of Object.entries(args.tokens as Record<string, string>)) {
    out[label] = tokenOutcome(await atClockAsync(clock, () => verify(token)))
  }
  return out
}

interface PromptInput {
  parts: { text: string; repeat?: number }[]
  toolError?: boolean
}

/** Each prompt's text is its parts joined, each repeated `repeat` times (default 1). */
function promptFactsOf(args: Record<string, unknown>): unknown {
  const out: Record<string, unknown> = {}
  for (const [label, prompt] of Object.entries(args.prompts as Record<string, PromptInput>)) {
    const text = prompt.parts.map(part => part.text.repeat(part.repeat ?? 1)).join('')
    out[label] = promptFacts(text, prompt.toolError)
  }
  return out
}

interface ResourceInput {
  resource: string
  authorizationServer: string
  documentation?: string
  metadataPath?: string
  serverName?: string
  description: string
  jsonRpcId?: unknown
}

/**
 * Each resource's canonical form, metadata document, metadata path and 401
 * challenge, or `{ refused }` with the reason when it cannot be a resource.
 */
async function oauthResources(args: Record<string, unknown>): Promise<unknown> {
  const out: Record<string, unknown> = {}
  for (const [label, input] of Object.entries(args.resources as Record<string, ResourceInput>)) {
    let canonical: string
    try {
      canonical = canonicalResource(input.resource)
    } catch (error) {
      out[label] = { refused: comparableDetail((error as Error).message) }
      continue
    }
    const resource = {
      resource: input.resource,
      authorizationServer: input.authorizationServer,
      documentation: input.documentation,
      metadataPath: input.metadataPath,
    }
    const challenge = authChallenge({
      protectedResource: resource,
      description: input.description,
      jsonRpcId: input.jsonRpcId,
    })
    out[label] = {
      canonical,
      metadata: protectedResourceMetadata({ ...resource, serverName: input.serverName }),
      metadataPath: protectedResourceMetadataPath(resource),
      challenge: {
        status: challenge.status,
        headers: {
          'www-authenticate': challenge.headers.get('www-authenticate'),
          'access-control-expose-headers': challenge.headers.get('access-control-expose-headers'),
          'content-type': challenge.headers.get('content-type'),
        },
        body: await challenge.json(),
      },
    }
  }
  return out
}

export const AGENT_IDENTITY_OPERATIONS: Record<string, Implementation[]> = {
  verifyAgentTokens: [{ name: 'agents', run: (args, clock) => verifyAgentTokens(args, clock) }],
  promptFacts: [{ name: 'agents', run: args => promptFactsOf(args) }],
  oauthResources: [{ name: 'agents', run: args => oauthResources(args) }],
}

// ---- scenario steps ----------------------------------------------------------
//
// One agent key verifier per scenario and merchant environment (`environment`,
// unset by default), so its 30-second cache carries across steps. Its clock is
// the step's (`Date.now`, fixed by the scenario runner).

type KeyVerifier = ReturnType<typeof createAgentKeyVerifier>
const keyVerifiers = new WeakMap<object, Map<string, KeyVerifier>>()

function keyVerifierFor(session: object, environment: AgentEnvironment | undefined): KeyVerifier {
  let byEnvironment = keyVerifiers.get(session)
  if (!byEnvironment) keyVerifiers.set(session, (byEnvironment = new Map()))
  const key = environment ?? 'unset'
  let verifier = byEnvironment.get(key)
  if (!verifier) {
    verifier = createAgentKeyVerifier({
      client: createSolvaPayAgentClient({
        apiBaseUrl: CONFORMANCE_API,
        secretKey: 'sk_sandbox_conformance',
        fetchImpl: (input, init) => globalThis.fetch(input, init),
      }),
      environment,
      now: () => Date.now(),
    })
    byEnvironment.set(key, verifier)
  }
  return verifier
}

/** An error the verifier throws (SolvaPay failing or misanswering): its HTTP status, if any. */
function thrown(error: unknown): Record<string, unknown> {
  const status = (error as { status?: unknown }).status
  return { thrown: { status: typeof status === 'number' ? status : null } }
}

/** The step's outcome, or `undefined` when `fn` is not one of these steps. */
export async function agentIdentityStep(
  session: object,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ result: unknown } | undefined> {
  switch (fn) {
    case 'verifyAgentKey': {
      const verify = keyVerifierFor(session, environmentOf(args))
      try {
        return { result: tokenOutcome(await verify(args.agentKey as string)) }
      } catch (error) {
        return { result: thrown(error) }
      }
    }
    case 'identify': {
      const layer = createAgentLayer({
        verifyAgentToken: tokenVerifier(args),
        ...(args.acceptAgentKeys === true
          ? { verifyAgentKey: keyVerifierFor(session, environmentOf(args)) }
          : {}),
      })
      try {
        return { result: identificationOutcome(await layer.identify(args.presentedKey as string)) }
      } catch (error) {
        return { result: thrown(error) }
      }
    }
    default:
      return undefined
  }
}
