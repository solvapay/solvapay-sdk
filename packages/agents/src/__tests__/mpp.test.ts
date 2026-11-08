import { describe, expect, it } from 'vitest'
import { createAgentCalls } from '../calls'
import { createAgentKeyVerifier, createAgentLayer } from '../identity'
import { createAgentHttpGate } from '../http'
import {
  MPP_AGENT_KEY_HEADER,
  MPP_RECEIPT_HEADER,
  mppCredentialOf,
  parseCredential,
  type MppCredentialResult,
  type SolvaPayMppClient,
} from '../mpp'
import { FakeAgentApi } from '../testing'

const PAYER_KEY = 'agk_sandbox_MPPPAYER'
const CREDENTIAL = 'Payment eyJjaGFsbGVuZ2UiOnt9fQ'
const RECEIPT = {
  method: 'stripe',
  reference: 'pi_1PAID',
  status: 'success' as const,
  timestamp: '2026-11-08T12:00:00Z',
}

class FakeMpp implements SolvaPayMppClient {
  readonly challenges: { realm: string; agentKey?: string }[] = []
  readonly credentials: { realm: string; authorization: string; agentKey?: string }[] = []
  answer: MppCredentialResult = {
    status: 'paid',
    agentKey: PAYER_KEY,
    agentRef: 'agt_MPPPAYER',
    customerRef: 'cus_MPPPAYER',
    lot: {
      reference: 'lot_MPP00001',
      paymentIntentId: 'pi_1PAID',
      amount: { amount: '2.50', currency: 'USD' },
    },
    receipt: RECEIPT,
  }
  async challenge(input: { realm: string; agentKey?: string }) {
    this.challenges.push(input)
    return {
      wwwAuthenticate: [
        'Payment id="ch_1", realm="api.merchant.test", method="stripe", intent="charge"',
      ],
      lot: { amount: { amount: '2.50', currency: 'USD' } },
    }
  }
  async credential(input: { realm: string; authorization: string; agentKey?: string }) {
    this.credentials.push(input)
    return this.answer
  }
}

function setup() {
  const agentApi = new FakeAgentApi()
  agentApi.agentKeys.set(PAYER_KEY, {
    agentRef: 'agt_MPPPAYER',
    principalRef: 'ppl_MPPPAYER',
    promptExcerpt: false,
    environment: 'sandbox',
    payer: 'mpp',
  })
  const mpp = new FakeMpp()
  const log = { info: () => undefined, error: () => undefined }
  const gate = createAgentHttpGate({
    agentLayer: createAgentLayer({
      verifyAgentToken: async () => ({ ok: false, reason: 'invalid', detail: 'no tokens here' }),
      verifyAgentKey: createAgentKeyVerifier({ client: agentApi }),
    }),
    calls: createAgentCalls({ client: agentApi, maxWaitSeconds: 0, log }),
    log,
    mpp: { client: mpp, realm: 'api.merchant.test' },
  })
  const call = (presentedKey: string, mppCredential: string | null = null) =>
    gate({
      presentedKey,
      requestId: 'req-1',
      item: 'answer',
      estimate: { amount: '0.05', currency: 'USD' },
      prompt: null,
      signal: new AbortController().signal,
      mppCredential,
    })
  return { agentApi, mpp, call }
}

describe('createAgentHttpGate with MPP', () => {
  it('answers a call with no key with an MPP challenge, asking SolvaPay for its headers', async () => {
    const { agentApi, mpp, call } = setup()
    const result = await call('')
    if (result.kind !== 'mpp_challenge') throw new Error(`not a challenge: ${result.kind}`)
    expect(result.status).toBe(402)
    expect(result.headers.get('www-authenticate')).toContain('method="stripe"')
    expect(mpp.challenges).toEqual([{ realm: 'api.merchant.test' }])
    expect(agentApi.authorizes).toHaveLength(0)
  })

  it('leaves a key that is not SolvaPay’s to the merchant’s own auth', async () => {
    const { mpp, call } = setup()
    expect(await call('sk_merchant_key')).toEqual({ kind: 'not_agent' })
    expect(mpp.challenges).toHaveLength(0)
  })

  it('forwards a credential, then authorizes on the new payer’s key, with receipt and key headers', async () => {
    const { agentApi, mpp, call } = setup()
    const result = await call('', CREDENTIAL)
    if (result.kind !== 'allowed') throw new Error(`not allowed: ${result.kind}`)
    expect(mpp.credentials).toEqual([{ realm: 'api.merchant.test', authorization: CREDENTIAL }])
    expect(agentApi.authorizes).toEqual([
      expect.objectContaining({ agentToken: PAYER_KEY, requestId: 'req-1' }),
    ])
    expect(result.paid?.get(MPP_AGENT_KEY_HEADER)).toBe(PAYER_KEY)
    const receipt = JSON.parse(
      Buffer.from(result.paid!.get(MPP_RECEIPT_HEADER)!, 'base64url').toString(),
    )
    expect(receipt).toEqual({ ...RECEIPT, callRef: result.allowed.callRef })
  })

  it('sends the payer’s key with a credential when it pays again, and hands out no new key', async () => {
    const { mpp, call } = setup()
    mpp.answer = {
      ...(mpp.answer as Extract<MppCredentialResult, { status: 'paid' }>),
      agentKey: undefined,
    }
    const result = await call(PAYER_KEY, CREDENTIAL)
    if (result.kind !== 'allowed') throw new Error(`not allowed: ${result.kind}`)
    expect(mpp.credentials).toEqual([
      { realm: 'api.merchant.test', authorization: CREDENTIAL, agentKey: PAYER_KEY },
    ])
    expect(result.paid?.has(MPP_AGENT_KEY_HEADER)).toBe(false)
  })

  it('answers a credential that did not pay with a new challenge and the problem', async () => {
    const { agentApi, mpp, call } = setup()
    mpp.answer = {
      status: 'refused',
      wwwAuthenticate: ['Payment id="ch_2"'],
      problem: { detail: 'Payment has already been processed.' },
    }
    const result = await call('', CREDENTIAL)
    expect(result).toMatchObject({
      kind: 'mpp_challenge',
      status: 402,
      problem: { detail: 'Payment has already been processed.' },
    })
    expect(agentApi.authorizes).toHaveLength(0)
  })

  it('challenges an MPP payer short of balance again, with SolvaPay’s sentence', async () => {
    const { agentApi, mpp, call } = setup()
    agentApi.outcome = 'refused'
    agentApi.refusal = { reason: 'topup_required', message: 'Pay again with MPP to buy more.' }
    const result = await call(PAYER_KEY)
    expect(result).toMatchObject({
      kind: 'mpp_challenge',
      refused: { reason: 'topup_required', message: 'Pay again with MPP to buy more.' },
    })
    expect(mpp.challenges).toEqual([{ realm: 'api.merchant.test', agentKey: PAYER_KEY }])
  })

  it('keeps an owned agent’s topup_required a refusal: its owner tops it up, not MPP', async () => {
    const { agentApi, mpp, call } = setup()
    agentApi.agentKeys.set(PAYER_KEY, { ...agentApi.agentKeys.get(PAYER_KEY)!, payer: undefined })
    agentApi.outcome = 'refused'
    agentApi.refusal = { reason: 'topup_required', message: 'Top up to continue.' }
    expect(await call(PAYER_KEY)).toMatchObject({ kind: 'refused', status: 402 })
    expect(mpp.challenges).toHaveLength(0)
  })
})

describe('mppCredentialOf', () => {
  it('reads Payment-Authorization first, else an Authorization in the Payment scheme', () => {
    expect(mppCredentialOf(new Headers({ authorization: CREDENTIAL }))).toBe(CREDENTIAL)
    expect(
      mppCredentialOf(
        new Headers({ authorization: `Bearer ${PAYER_KEY}`, 'payment-authorization': CREDENTIAL }),
      ),
    ).toBe(CREDENTIAL)
    expect(mppCredentialOf(new Headers({ authorization: `Bearer ${PAYER_KEY}` }))).toBeNull()
    expect(() => mppCredentialOf(new Headers({ 'payment-authorization': 'Bearer x' }))).toThrow(
      /Payment scheme/,
    )
  })
})

describe('parseCredential', () => {
  it('refuses a paid answer missing what the payer is served on', () => {
    expect(() =>
      parseCredential({
        status: 'paid',
        agentRef: 'agt_X',
        customerRef: 'cus_X',
        lot: {},
        receipt: RECEIPT,
      }),
    ).toThrow(/lot.reference/)
    expect(() => parseCredential({ status: 'maybe' })).toThrow(/not paid or refused/)
  })
})
