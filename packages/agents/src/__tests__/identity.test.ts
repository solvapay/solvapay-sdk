import { createLocalJWKSet, SignJWT, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { AgentApiError, createSolvaPayAgentClient, secretKeyEnvironment } from '../client'
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

function verifier(environment?: 'sandbox' | 'live') {
  return createAgentTokenVerifier({
    issuer: ISSUER,
    providerRef: PROVIDER,
    keys: createLocalJWKSet({ keys: [publicJwk] }),
    ...(environment ? { environment } : {}),
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

  it('reads where the agent spends from the env claim', async () => {
    const sandbox = await verifier()(await signAgentToken(privateKey))
    const live = await verifier()(await signAgentToken(privateKey, { env: 'live' }))
    expect(sandbox).toMatchObject({ ok: true, agent: { environment: 'sandbox' } })
    expect(live).toMatchObject({ ok: true, agent: { environment: 'live' } })
  })

  it.each([
    ['without an env claim', null],
    ['with an unknown env', 'production'],
  ])('refuses a token %s', async (_case, env) => {
    const result = await verifier()(await signAgentToken(privateKey, { env }))
    expect(result).toEqual({ ok: false, reason: 'invalid', detail: 'env is not sandbox or live' })
  })

  it("refuses an agent from the other environment when it knows the secret key's", async () => {
    const live = await signAgentToken(privateKey, { env: 'live' })
    expect(await verifier('sandbox')(live)).toEqual({
      ok: false,
      reason: 'environment_mismatch',
      detail: 'This agent spends in live, and this secret key is for sandbox',
    })
    expect(await verifier('live')(live)).toMatchObject({ ok: true })
    // Without the merchant's environment, SolvaPay refuses it at authorize.
    expect(await verifier()(live)).toMatchObject({ ok: true })
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
      agent: {
        agentRef: 'agt_TESTAGNT',
        principalRef: 'ppl_ABCDEFGHIJKLMNOP',
        promptExcerpt: false,
        environment: 'sandbox',
      },
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

  it("takes a key's environment from SolvaPay's verification, and throws when it is missing", async () => {
    const answer = (body: Record<string, unknown>) =>
      createSolvaPayAgentClient({
        apiBaseUrl: 'https://api.solvapay.test',
        secretKey: 'sk_live_TEST',
        fetchImpl: async () => Response.json(body),
      })
    const agent = {
      agentRef: 'agt_TESTAGNT',
      principalRef: 'ppl_ABCDEFGHIJKLMNOP',
      promptExcerpt: false,
    }
    const live = createAgentKeyVerifier({ client: answer({ ...agent, environment: 'live' }) })
    expect(await live('agk_live_KEY')).toMatchObject({ ok: true, agent: { environment: 'live' } })

    const missing = createAgentKeyVerifier({ client: answer(agent) })
    await expect(missing('agk_live_KEY')).rejects.toThrow('environment')
  })

  it('rejects a key from the other environment, whether it or SolvaPay notices', async () => {
    const local = createAgentKeyVerifier({ client: new FakeAgentApi(), environment: 'live' })
    expect(await local(TEST_AGENT_KEY)).toMatchObject({
      ok: false,
      reason: 'environment_mismatch',
    })

    const server = createAgentKeyVerifier({
      client: {
        verifyAgentKey: async () => {
          throw new AgentApiError(
            'POST /v1/sdk/agent/keys/verifications failed (403): {"code":"environment_mismatch"}',
            403,
            'environment_mismatch',
          )
        },
      },
    })
    expect(await server(TEST_AGENT_KEY)).toMatchObject({
      ok: false,
      reason: 'environment_mismatch',
    })
  })

  it('throws when SolvaPay refuses the merchant rather than the key, and reads the code, not the sentence', async () => {
    const answering = (status: number, body: unknown) =>
      createAgentKeyVerifier({
        client: createSolvaPayAgentClient({
          apiBaseUrl: 'https://api.solvapay.test',
          secretKey: 'sk_sandbox_TEST',
          fetchImpl: async () => Response.json(body, { status }),
        }),
      })
    // Agent payments are off for this merchant: the merchant's to fix, never the agent's.
    await expect(
      answering(403, {
        statusCode: 403,
        code: 'feature_not_enabled',
        feature: 'agent_payments',
        message: 'Feature "agent_payments" is not enabled for this provider',
      })('agk_sandbox_KEY'),
    ).rejects.toThrow('feature_not_enabled')
    // The secret key is for the other environment.
    await expect(
      answering(403, {
        statusCode: 403,
        code: 'key_env_mismatch',
        message: 'sandbox key, live account',
      })('agk_sandbox_KEY'),
    ).rejects.toThrow('key_env_mismatch')
    // Another merchant's key: SolvaPay sends no code.
    expect(
      await answering(403, {
        statusCode: 403,
        message: 'This agent key was issued for another merchant',
        error: 'Forbidden',
      })('agk_sandbox_KEY'),
    ).toMatchObject({ ok: false, reason: 'invalid' })
    // A sentence that mentions environment_mismatch is not the code.
    expect(
      await answering(403, { statusCode: 403, message: 'not an environment_mismatch' })(
        'agk_sandbox_KEY',
      ),
    ).toMatchObject({ ok: false, reason: 'invalid' })
    // A 403 whose body is not JSON is a proxy's page, not SolvaPay refusing the key.
    const notJson = createAgentKeyVerifier({
      client: createSolvaPayAgentClient({
        apiBaseUrl: 'https://api.solvapay.test',
        secretKey: 'sk_sandbox_TEST',
        fetchImpl: async () => new Response('Forbidden', { status: 403 }),
      }),
    })
    await expect(notJson('agk_sandbox_KEY')).rejects.toMatchObject({
      status: 403,
      code: 'non_json_response',
    })
  })

  it("reads a secret key's environment from its prefix, and doesn't guess otherwise", () => {
    expect(secretKeyEnvironment('sk_sandbox_abc')).toBe('sandbox')
    expect(secretKeyEnvironment('sk_live_abc')).toBe('live')
    expect(secretKeyEnvironment('sk_abc')).toBeUndefined()
  })

  it('leaves an agent key to the merchant when the layer takes no keys', async () => {
    const layer = createAgentLayer({
      verifyAgentToken: async () => ({ ok: false, reason: 'invalid', detail: '' }),
    })
    expect(await layer.identify(TEST_AGENT_KEY)).toEqual({ kind: 'not_agent' })
  })
})
