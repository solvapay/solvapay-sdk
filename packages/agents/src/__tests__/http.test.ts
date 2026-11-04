import { createLocalJWKSet, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAgentCalls, type RefusalReason } from '../calls'
import { createAgentLayer, createAgentTokenVerifier } from '../identity'
import { createAgentHttpGate, refusalResponse, refusalStatus } from '../http'
import { agentKeys, FakeAgentApi, ISSUER, PROVIDER, signAgentToken } from '../testing'

let agentKey: CryptoKey
let agentJwk: JWK

beforeAll(async () => {
  const keys = await agentKeys()
  agentKey = keys.privateKey
  agentJwk = keys.publicJwk
})

function setup() {
  const agentApi = new FakeAgentApi()
  const log = { info: () => undefined, error: () => undefined }
  const gate = createAgentHttpGate({
    agentLayer: createAgentLayer({
      verifyAgentToken: createAgentTokenVerifier({
        issuer: ISSUER,
        providerRef: PROVIDER,
        keys: createLocalJWKSet({ keys: [agentJwk] }),
      }),
    }),
    calls: createAgentCalls({ client: agentApi, maxWaitSeconds: 0, log }),
    log,
  })
  const call = (presentedKey: string) =>
    gate({
      presentedKey,
      requestId: 'req-1',
      item: 'claude-haiku-4-5',
      estimate: { amount: '0.005', currency: 'USD' },
      prompt: null,
      signal: new AbortController().signal,
    })
  return { agentApi, call }
}

describe('createAgentHttpGate', () => {
  it('leaves a non-agent key to the merchant', async () => {
    const { agentApi, call } = setup()
    expect(await call('sk_merchant_key')).toEqual({ kind: 'not_agent' })
    expect(agentApi.authorizes).toHaveLength(0)
  })

  it('rejects an agent token that does not verify, without asking SolvaPay', async () => {
    const { agentApi, call } = setup()
    expect(await call(await signAgentToken(agentKey, { expiresIn: '-5m' }))).toMatchObject({
      kind: 'rejected',
      status: 401,
      reason: 'expired',
    })
    expect(agentApi.authorizes).toHaveLength(0)
  })

  it('authorizes an agent call, and completes it through the allowed call', async () => {
    const { agentApi, call } = setup()
    const result = await call(await signAgentToken(agentKey))
    if (result.kind !== 'allowed') throw new Error(`not allowed: ${result.kind}`)
    expect(result.allowed.callRef).toBe('call_TEST0001')
    expect(result.agent.agentRef).toBe('agt_TESTAGNT')

    await result.allowed.finish({ status: 200, cost: { amount: 0.0012, currency: 'USD' } })
    expect(agentApi.completes).toEqual([
      { callRef: 'call_TEST0001', status: 200, cost: { amount: '0.0012', currency: 'USD' } },
    ])
  })

  it('refuses with the status that matches the reason', async () => {
    const { agentApi, call } = setup()
    agentApi.outcome = 'refused'
    agentApi.refusal = { reason: 'topup_required', message: 'Top up to continue.' }
    expect(await call(await signAgentToken(agentKey))).toMatchObject({
      kind: 'refused',
      status: 402,
      refused: { reason: 'topup_required', message: 'Top up to continue.' },
    })
  })
})

describe('refusalStatus', () => {
  it('maps every refusal reason to a status', () => {
    const cases: [RefusalReason, number][] = [
      ['agent_not_accepted', 401],
      ['unavailable', 502],
      ['deny', 422],
      ['customer_not_linked', 402],
      ['topup_required', 402],
      ['ask', 402],
      ['approval_declined', 402],
      ['approval_expired', 402],
      ['approval_timed_out', 402],
      ['approval_client_closed', 402],
    ]
    for (const [reason, status] of cases) expect(refusalStatus(reason)).toBe(status)
  })

  it('writes a plain JSON refusal', async () => {
    const response = refusalResponse({ kind: 'refused', reason: 'deny', message: 'Over the cap.' })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: { type: 'deny', message: 'Over the cap.' } })
  })
})
