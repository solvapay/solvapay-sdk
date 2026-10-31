import { createLocalJWKSet, SignJWT, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { AgentApiError } from '../client'
import {
  createAgentKeyVerifier,
  createAgentLayer,
  createAgentTokenVerifier,
  looksLikeJwt,
} from '../identity'
import {
  agentKeys,
  FakeAgentApi,
  ISSUER,
  PROVIDER,
  signAgentToken,
  TEST_AGENT_KEY,
} from '../testing'

let privateKey: CryptoKey
let publicJwk: JWK

beforeAll(async () => {
  ;({ privateKey, publicJwk } = await agentKeys())
})

function verifier() {
  return createAgentTokenVerifier({
    issuer: ISSUER,
    providerRef: PROVIDER,
    keys: createLocalJWKSet({ keys: [publicJwk] }),
  })
}

describe('agent token verification', () => {
  it('accepts a valid token and returns the agent and principal', async () => {
    const result = await verifier()(await signAgentToken(privateKey))
    expect(result).toMatchObject({
      ok: true,
      agent: { agentRef: 'agt_TESTAGNT', principalRef: 'ppl_ABCDEFGHIJKLMNOP' },
    })
  })

  it('reads whether the prompt excerpt may go from the px claim (DEV-1124)', async () => {
    const off = await verifier()(await signAgentToken(privateKey))
    const on = await verifier()(await signAgentToken(privateKey, { promptExcerpt: true }))
    expect(off).toMatchObject({ ok: true, agent: { promptExcerpt: false } })
    expect(on).toMatchObject({ ok: true, agent: { promptExcerpt: true } })
  })

  it('reports an expired token as expired', async () => {
    const token = await new SignJWT({ principal: 'ppl_ABCDEFGHIJKLMNOP', scope: 'usage' })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(PROVIDER)
      .setSubject('agt_TESTAGNT')
      .setJti('j')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 120)
      .sign(privateKey)
    expect(await verifier()(token)).toMatchObject({ ok: false, reason: 'expired' })
  })

  it.each([
    ['another provider', { aud: 'prov_OTHER001' }],
    ['another issuer', { iss: 'https://evil.test/v1/agent' }],
    ['an unknown key id', { kid: 'k2' }],
    ['no principal', { principal: null }],
    ['a non-agent subject', { sub: 'usr_1' }],
    ['another scope', { scope: 'payments' }],
  ])('refuses a token for %s', async (_case, overrides) => {
    const result = await verifier()(await signAgentToken(privateKey, overrides))
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it("refuses a token with the old scope 'inference'", async () => {
    const result = await verifier()(await signAgentToken(privateKey, { scope: 'inference' }))
    expect(result).toEqual({ ok: false, reason: 'invalid', detail: 'scope is not usage' })
  })

  it('refuses an HS256 token and one signed by another key', async () => {
    const hs = await new SignJWT({ principal: 'ppl_X', scope: 'usage' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(PROVIDER)
      .setSubject('agt_TESTAGNT')
      .setJti('j')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('a-shared-secret-of-sufficient-length'))
    expect(await verifier()(hs)).toMatchObject({ ok: false, reason: 'invalid' })

    const other = await agentKeys()
    expect(await verifier()(await signAgentToken(other.privateKey))).toMatchObject({
      ok: false,
      reason: 'invalid',
    })
  })
})

describe('agent layer', () => {
  it('passes a non-JWT key to the merchant, and classifies tokens', async () => {
    const layer = createAgentLayer({ verifyAgentToken: verifier() })
    expect(await layer.identify('op-clone-abc')).toEqual({ kind: 'not_agent' })
    expect((await layer.identify(await signAgentToken(privateKey))).kind).toBe('agent')
    expect(
      (await layer.identify(await signAgentToken(privateKey, { aud: 'prov_OTHER001' }))).kind,
    ).toBe('rejected')
    expect(looksLikeJwt('a.b.c')).toBe(true)
    expect(looksLikeJwt('op-clone-a.b')).toBe(false)
  })
})

describe('agent keys', () => {
  it('reads an agent key through SolvaPay, reusing the answer for 30 seconds', async () => {
    const api = new FakeAgentApi()
    let clock = 0
    const layer = createAgentLayer({
      verifyAgentToken: async () => {
        throw new Error('not a token')
      },
      verifyAgentKey: createAgentKeyVerifier({ client: api, now: () => clock }),
    })

    expect(await layer.identify(TEST_AGENT_KEY)).toEqual({
      kind: 'agent',
      agent: { agentRef: 'agt_TESTAGNT', principalRef: 'ppl_ABCDEFGHIJKLMNOP', promptExcerpt: false },
    })
    await layer.identify(TEST_AGENT_KEY)
    expect(api.keyVerifications).toHaveLength(1)
    clock = 30_001
    await layer.identify(TEST_AGENT_KEY)
    expect(api.keyVerifications).toHaveLength(2)
  })

  it('rejects a key SolvaPay does not know, and throws when SolvaPay is out of reach', async () => {
    const api = new FakeAgentApi()
    const verify = createAgentKeyVerifier({ client: api })
    expect(await verify('agk_UNKNOWN')).toMatchObject({ ok: false, reason: 'invalid' })

    const down = createAgentKeyVerifier({
      client: {
        verifyAgentKey: async () => {
          throw new AgentApiError('POST /v1/sdk/agent/keys/verifications failed (503)', 503)
        },
      },
    })
    await expect(down('agk_ANY')).rejects.toThrow('503')
  })

  it('leaves an agent key to the merchant when the layer takes no keys', async () => {
    const layer = createAgentLayer({ verifyAgentToken: async () => ({ ok: false, reason: 'invalid', detail: '' }) })
    expect(await layer.identify(TEST_AGENT_KEY)).toEqual({ kind: 'not_agent' })
  })
})
