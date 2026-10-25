// Who is calling: SolvaPay agent tokens are ES256 JWTs signed by SolvaPay's
// agent service, published at `<issuer>/jwks.json`, issued for one merchant
// (`aud` = its provider reference). Anything else a caller presents is the
// merchant's own auth.
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose'

export interface VerifiedAgent {
  /** The agent, `agt_…` (token `sub`). */
  agentRef: string
  /** Pairwise reference of the account at this merchant, `ppl_…`. */
  principalRef: string
  tokenId: string
  expiresAt: Date
}

export type AgentTokenResult =
  | { ok: true; agent: VerifiedAgent }
  | { ok: false; reason: 'expired' | 'invalid'; detail: string }

export interface AgentTokenVerifierOptions {
  /** SolvaPay's agent token issuer, e.g. `https://api.solvapay.com/v1/agent`. */
  issuer: string
  /** This merchant's provider reference; tokens for any other provider are refused. */
  providerRef: string
  /** Key resolver: `createRemoteJWKSet(new URL(jwksUrl))` in production. */
  keys: JWTVerifyGetKey
}

const CLOCK_TOLERANCE_SECONDS = 30

export function createAgentTokenVerifier(options: AgentTokenVerifierOptions) {
  return async function verifyAgentToken(token: string): Promise<AgentTokenResult> {
    try {
      const { payload } = await jwtVerify(token, options.keys, {
        issuer: options.issuer,
        audience: options.providerRef,
        algorithms: ['ES256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'iat', 'jti'],
      })
      const { sub, jti, exp, principal, scope } = payload
      if (typeof sub !== 'string' || !sub.startsWith('agt_')) {
        return { ok: false, reason: 'invalid', detail: 'sub is not an agent reference' }
      }
      if (typeof principal !== 'string' || !principal.startsWith('ppl_')) {
        return { ok: false, reason: 'invalid', detail: 'principal is missing' }
      }
      if (scope !== 'usage') {
        return { ok: false, reason: 'invalid', detail: 'scope is not usage' }
      }
      return {
        ok: true,
        agent: {
          agentRef: sub,
          principalRef: principal,
          tokenId: jti as string,
          expiresAt: new Date((exp as number) * 1000),
        },
      }
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

/** A JWS compact token, as opposed to a merchant API key. */
export function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
}

export type Identification =
  | { kind: 'agent'; agent: VerifiedAgent }
  /** Not an agent token; the merchant's own auth decides. */
  | { kind: 'not_agent' }
  | { kind: 'rejected'; reason: 'expired' | 'invalid'; detail: string }

export interface AgentLayer {
  identify(presentedKey: string): Promise<Identification>
}

export function createAgentLayer(deps: {
  verifyAgentToken: (token: string) => Promise<AgentTokenResult>
}): AgentLayer {
  return {
    async identify(presentedKey) {
      if (!looksLikeJwt(presentedKey)) return { kind: 'not_agent' }
      const result = await deps.verifyAgentToken(presentedKey)
      return result.ok
        ? { kind: 'agent', agent: result.agent }
        : { kind: 'rejected', reason: result.reason, detail: result.detail }
    },
  }
}
