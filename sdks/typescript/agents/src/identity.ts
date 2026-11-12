// Who is calling: SolvaPay agent tokens are ES256 JWTs signed by SolvaPay's
// agent service, published at `<issuer>/jwks.json`, issued for one merchant
// (`aud` = its provider reference). Agent keys (`agk_…`) are long-lived and
// opaque: SolvaPay says whose they are. Anything else a caller presents is
// the merchant's own auth. The checks run in the Rust core
// (`verifyAgentToken`, `agentKeyVerificationResult`, `agentCredentialKind`);
// fetching and caching the published keys is this file's job.
import { AgentApiError, type AgentEnvironment, type SolvaPayAgentClient } from './client'
import {
  agentCredentialKind,
  agentKeyVerificationResult,
  unwrap,
  verifyAgentToken as verifyAgentTokenInCore,
} from './core'

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
  /** The issuer's published keys: `remoteAgentJwks(\`${issuer}/jwks.json\`)` in production. */
  jwks: AgentJwks
  /**
   * The environment this merchant's secret key is for (`secretKeyEnvironment`);
   * an agent from the other is refused. Unset, SolvaPay refuses it at authorize.
   */
  environment?: AgentEnvironment
  /** The clock, in milliseconds; tests set it. */
  now?: () => number
}

/** A JSON Web Key Set, as the issuer publishes it at `<issuer>/jwks.json`. */
export interface JwksDocument {
  keys: Record<string, unknown>[]
}

/**
 * Where the verifier gets the issuer's keys: the document itself, or a loader.
 * A loader is asked again with `{ refresh: true }` once when a token's
 * signature does not verify, so a rotated key is picked up.
 */
export type AgentJwks = JwksDocument | ((options: { refresh: boolean }) => Promise<JwksDocument>)

/** How long `remoteAgentJwks` keeps a fetched key set. */
const JWKS_CACHE_MS = 5 * 60_000
/** The least time between two fetches, so bad tokens cannot make it fetch on every call. */
const JWKS_MIN_REFRESH_MS = 30_000

/**
 * Fetches the issuer's key set, keeps it five minutes, and fetches again on
 * a refresh (at most every 30 seconds). A failed fetch throws: no token is
 * accepted on keys that could not be read.
 */
export function remoteAgentJwks(
  url: string,
  options: { fetchImpl?: typeof fetch; now?: () => number } = {},
): (options: { refresh: boolean }) => Promise<JwksDocument> {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  let cached: { document: JwksDocument; fetchedAt: number } | undefined
  return async ({ refresh }) => {
    const age = cached ? now() - cached.fetchedAt : Infinity
    if (cached && (refresh ? age < JWKS_MIN_REFRESH_MS : age < JWKS_CACHE_MS)) {
      return cached.document
    }
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`GET ${url} failed (${response.status})`)
    const document = (await response.json()) as unknown
    if (
      typeof document !== 'object' ||
      document === null ||
      !Array.isArray((document as JwksDocument).keys)
    ) {
      throw new Error(`${url} is not a JSON Web Key Set`)
    }
    cached = { document: document as JwksDocument, fetchedAt: now() }
    return cached.document
  }
}

/** The core's detail when no published key verifies a signature. */
const BAD_SIGNATURE = 'signature does not verify against the published keys'

interface CoreAgent extends Omit<VerifiedAgent, 'expiresAt'> {
  /** Unix seconds. */
  expiresAt?: number
}

type CoreTokenResult =
  | { ok: true; agent: CoreAgent }
  | { ok: false; reason: AgentRejectionReason; detail: string }

function fromCore(result: CoreTokenResult): AgentTokenResult {
  if (!result.ok) return result
  const { expiresAt, ...agent } = result.agent
  return {
    ok: true,
    agent: {
      ...agent,
      ...(expiresAt === undefined ? {} : { expiresAt: new Date(expiresAt * 1000) }),
    },
  }
}

export function createAgentTokenVerifier(options: AgentTokenVerifierOptions) {
  const now = options.now ?? Date.now
  const keys = async (refresh: boolean): Promise<JwksDocument> =>
    typeof options.jwks === 'function' ? options.jwks({ refresh }) : options.jwks
  const check = (token: string, jwks: JwksDocument) =>
    fromCore(
      unwrap<CoreTokenResult>(
        verifyAgentTokenInCore({
          token,
          jwks,
          issuer: options.issuer,
          providerRef: options.providerRef,
          ...(options.resource ? { resource: options.resource } : {}),
          ...(options.environment ? { environment: options.environment } : {}),
          nowUnixSecs: Math.floor(now() / 1000),
        }),
      ),
    )
  return async function verifyAgentToken(token: string): Promise<AgentTokenResult> {
    const result = check(token, await keys(false))
    if (!result.ok && result.detail === BAD_SIGNATURE && typeof options.jwks === 'function') {
      return check(token, await keys(true))
    }
    return result
  }
}

/** A JWS compact token, as opposed to a merchant API key. */
export function looksLikeJwt(value: string): boolean {
  return agentCredentialKind(value) === 'jwt'
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
  return agentCredentialKind(value) === 'agentKey'
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
    let input: Record<string, unknown>
    try {
      input = { verified: await deps.client.verifyAgentKey(agentKey) }
    } catch (error) {
      if (!(error instanceof AgentApiError) || (error.status !== 401 && error.status !== 403)) {
        throw error
      }
      input = { errorStatus: error.status, errorMessage: error.message }
    }
    const result = fromCore(
      unwrap<CoreTokenResult>(
        agentKeyVerificationResult({
          ...input,
          ...(deps.environment ? { environment: deps.environment } : {}),
        }),
      ),
    )
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
