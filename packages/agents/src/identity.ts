// Who is calling: SolvaPay agent tokens are ES256 JWTs signed by SolvaPay's
// agent service, published at `<issuer>/jwks.json`, issued for one merchant
// (`aud` = its provider reference). Agent keys (`agk_…`) are long-lived and
// opaque: SolvaPay says whose they are. Anything else a caller presents is
// the merchant's own auth.
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose'
import {
  AGENT_ENVIRONMENTS,
  AGENT_KEY_PREFIX,
  AgentApiError,
  type AgentEnvironment,
  type SolvaPayAgentClient,
} from './client'
import { canonicalResource } from './oauth'

/**
 * Agent token claim: the agent's spend policy lets the classifier read the
 * end of the prompt. Set by SolvaPay when it mints the token (DEV-1124).
 */
export const AGENT_TOKEN_EXCERPT_CLAIM = 'px'

/** Agent token claim: the OAuth client a host got the token as (`cid`), on OAuth tokens only. */
export const AGENT_TOKEN_CLIENT_CLAIM = 'cid'

/** Agent token claim: where the agent spends, `sandbox` or `live`. */
export const AGENT_TOKEN_ENV_CLAIM = 'env'

export interface VerifiedAgent {
  /** The agent, `agt_…` (token `sub`). */
  agentRef: string
  /** Pairwise reference of the account at this merchant, `ppl_…`. */
  principalRef: string
  /** The token's `jti`; absent for an agent key. */
  tokenId?: string
  /** When the token expires; absent for an agent key, which lasts until revoked. */
  expiresAt?: Date
  /** The prompt's end may go to SolvaPay with this agent's calls (`px` claim). */
  promptExcerpt: boolean
  /** Where the agent spends (`env` claim, or the key verification's answer). */
  environment: AgentEnvironment
  /** The OAuth client the token was issued to (`cid` claim): a CIMD URL or `oac_…`. */
  clientId?: string
}

/** Why an agent was turned away: `environment_mismatch` when it spends in the other environment. */
export type AgentRejectionReason = 'expired' | 'invalid' | 'environment_mismatch'

export type AgentTokenResult =
  | { ok: true; agent: VerifiedAgent }
  | { ok: false; reason: AgentRejectionReason; detail: string }

export interface AgentTokenVerifierOptions {
  /** SolvaPay's agent token issuer, e.g. `https://api.solvapay.com/v1/agent`. */
  issuer: string
  /** This merchant's provider reference; tokens for any other provider are refused. */
  providerRef: string
  /**
   * This server's OAuth resource (its MCP or API URL). A token a host got by
   * OAuth names it as `aud`, so it is accepted beside the provider reference;
   * any other URL is refused.
   */
  resource?: string
  /** Key resolver: `createRemoteJWKSet(new URL(jwksUrl))` in production. */
  keys: JWTVerifyGetKey
  /**
   * The environment this merchant's secret key is for (`secretKeyEnvironment`);
   * an agent from the other is refused. Unset, SolvaPay refuses it at authorize.
   */
  environment?: AgentEnvironment
}

const CLOCK_TOLERANCE_SECONDS = 30

export function createAgentTokenVerifier(options: AgentTokenVerifierOptions) {
  return async function verifyAgentToken(token: string): Promise<AgentTokenResult> {
    try {
      const { payload } = await jwtVerify(token, options.keys, {
        issuer: options.issuer,
        audience: options.resource
          ? [options.providerRef, canonicalResource(options.resource)]
          : options.providerRef,
        algorithms: ['ES256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'iat', 'jti'],
      })
      const { sub, jti, exp, principal, scope } = payload
      const clientId = payload[AGENT_TOKEN_CLIENT_CLAIM]
      if (clientId !== undefined && typeof clientId !== 'string') {
        return { ok: false, reason: 'invalid', detail: 'cid is not a string' }
      }
      if (typeof sub !== 'string' || !sub.startsWith('agt_')) {
        return { ok: false, reason: 'invalid', detail: 'sub is not an agent reference' }
      }
      if (typeof principal !== 'string' || !principal.startsWith('ppl_')) {
        return { ok: false, reason: 'invalid', detail: 'principal is missing' }
      }
      if (scope !== 'usage') {
        return { ok: false, reason: 'invalid', detail: 'scope is not usage' }
      }
      const environment = payload[AGENT_TOKEN_ENV_CLAIM]
      if (!isAgentEnvironment(environment)) {
        return { ok: false, reason: 'invalid', detail: 'env is not sandbox or live' }
      }
      return checkEnvironment(
        {
          agentRef: sub,
          principalRef: principal,
          tokenId: String(jti),
          expiresAt: new Date((exp as number) * 1000),
          promptExcerpt: payload[AGENT_TOKEN_EXCERPT_CLAIM] === true,
          environment,
          ...(clientId ? { clientId } : {}),
        },
        options.environment,
      )
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        return { ok: false, reason: 'expired', detail: error.message }
      }
      return {
        ok: false,
        reason: 'invalid',
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

function isAgentEnvironment(value: unknown): value is AgentEnvironment {
  return AGENT_ENVIRONMENTS.includes(value as AgentEnvironment)
}

/** Refuses an agent from the other environment; with the merchant's unknown, SolvaPay does. */
function checkEnvironment(
  agent: VerifiedAgent,
  merchant: AgentEnvironment | undefined,
): AgentTokenResult {
  if (merchant !== undefined && agent.environment !== merchant) {
    return {
      ok: false,
      reason: 'environment_mismatch',
      detail: `This agent spends in ${agent.environment}, and this secret key is for ${merchant}`,
    }
  }
  return { ok: true, agent }
}

/** A JWS compact token, as opposed to a merchant API key. */
export function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
}

export type Identification =
  | { kind: 'agent'; agent: VerifiedAgent }
  /** Not an agent token; the merchant's own auth decides. */
  | { kind: 'not_agent' }
  | { kind: 'rejected'; reason: AgentRejectionReason; detail: string }

export interface AgentLayer {
  identify(presentedKey: string): Promise<Identification>
}

export function isAgentKey(value: string): boolean {
  return value.startsWith(AGENT_KEY_PREFIX) && value.length > AGENT_KEY_PREFIX.length
}

/** How long an agent key's answer is reused; a revoked key stops within this. */
const AGENT_KEY_CACHE_MS = 30_000

/**
 * Asks SolvaPay whose an agent key is, reusing each answer for 30 seconds.
 * An unknown, revoked or other merchant's key is rejected, and so is one from
 * the other environment; SolvaPay out of reach throws, as every paid call
 * would fail the same way.
 */
export function createAgentKeyVerifier(deps: {
  client: Pick<SolvaPayAgentClient, 'verifyAgentKey'>
  /** As for `createAgentTokenVerifier`: unset, SolvaPay's answer decides. */
  environment?: AgentEnvironment
  now?: () => number
}): (agentKey: string) => Promise<AgentTokenResult> {
  const now = deps.now ?? Date.now
  const answers = new Map<string, { result: AgentTokenResult; until: number }>()
  return async agentKey => {
    const cached = answers.get(agentKey)
    if (cached && cached.until > now()) return cached.result
    let result: AgentTokenResult
    try {
      const verified = await deps.client.verifyAgentKey(agentKey)
      result = checkEnvironment(
        {
          agentRef: verified.agentRef,
          principalRef: verified.principalRef,
          promptExcerpt: verified.promptExcerpt,
          environment: verified.environment,
        },
        deps.environment,
      )
    } catch (error) {
      if (!(error instanceof AgentApiError) || (error.status !== 401 && error.status !== 403)) {
        throw error
      }
      // SolvaPay refuses a key from the other environment with this code in its 403.
      const reason =
        error.status === 403 && error.message.includes('environment_mismatch')
          ? 'environment_mismatch'
          : 'invalid'
      result = { ok: false, reason, detail: error.message }
    }
    answers.set(agentKey, { result, until: now() + AGENT_KEY_CACHE_MS })
    return result
  }
}

export function createAgentLayer(deps: {
  verifyAgentToken: (token: string) => Promise<AgentTokenResult>
  /** Accepts agent keys too; without it an agent key is the merchant's own auth's to answer. */
  verifyAgentKey?: (agentKey: string) => Promise<AgentTokenResult>
}): AgentLayer {
  return {
    async identify(presentedKey) {
      if (isAgentKey(presentedKey) && deps.verifyAgentKey) {
        const result = await deps.verifyAgentKey(presentedKey)
        return result.ok
          ? { kind: 'agent', agent: result.agent }
          : { kind: 'rejected', reason: result.reason, detail: result.detail }
      }
      if (!looksLikeJwt(presentedKey)) return { kind: 'not_agent' }
      const result = await deps.verifyAgentToken(presentedKey)
      return result.ok
        ? { kind: 'agent', agent: result.agent }
        : { kind: 'rejected', reason: result.reason, detail: result.detail }
    },
  }
}
