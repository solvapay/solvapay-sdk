import { describe, expect, it } from 'vitest'
import { AgentApiError, createSolvaPayAgentClient } from '../agent-layer/client'
import { createPolicy, type Decided } from '../agent-layer/policy'
import { FakeAgentApi } from './fakes'

const INPUT = {
  agentToken: 'eyJ.agent.token',
  requestId: 'req-1',
  model: 'claude-sonnet-4-6',
  tier: 'M' as const,
  estimateUsd: '0.0912',
}

function allowed(decided: Decided) {
  if (decided.action !== 'allow') throw new Error(`expected allow, got ${decided.action}`)
  return decided
}

describe('policy', () => {
  it('sends the token, model, tier and estimate, and returns the decision', async () => {
    const api = new FakeAgentApi()
    const decided = await createPolicy({ client: api }).decide(INPUT)
    expect(api.decides).toEqual([
      {
        agentToken: 'eyJ.agent.token',
        requestId: 'req-1',
        kind: 'inference',
        model: 'claude-sonnet-4-6',
        tier: 'M',
        estimatedCost: '0.0912',
      },
    ])
    expect(decided).toMatchObject({
      action: 'allow',
      decisionRef: 'dec_TEST0001',
      policy: { reference: 'pol_TESTPOL1', version: 2 },
    })
  })

  it.each(['ask', 'deny'] as const)(
    'returns %s with its reason and nothing to settle',
    async action => {
      const api = new FakeAgentApi()
      api.action = action
      api.reasonCode = action === 'ask' ? 'budget_exhausted_ask' : 'tier_not_allowed'
      api.reasonText = 'Reason for the human.'
      const decided = await createPolicy({ client: api }).decide(INPUT)
      expect(decided).toMatchObject({ action, reasonText: 'Reason for the human.' })
      expect('settle' in decided).toBe(false)
    },
  )

  it('settles at the reported cost, else the estimate as provisional, else releases', async () => {
    const api = new FakeAgentApi()
    const policy = createPolicy({ client: api })
    await allowed(await policy.decide(INPUT)).settle({ status: 200, costUsd: 0.0829554 })
    await allowed(await policy.decide(INPUT)).settle({ status: 200, costUsd: null })
    await allowed(await policy.decide(INPUT)).settle({ status: 529, costUsd: null })
    expect(api.settles.map(({ usagesBefore: _, ...rest }) => rest)).toEqual([
      { decisionRef: 'dec_TEST0001', source: 'reported', amountUsd: '0.0829554' },
      { decisionRef: 'dec_TEST0002', source: 'provisional', amountUsd: '0.0912' },
      { decisionRef: 'dec_TEST0003', source: 'none' },
    ])
  })

  it('releases once, and refuses a second settle of the same call', async () => {
    const api = new FakeAgentApi()
    const decided = allowed(await createPolicy({ client: api }).decide(INPUT))
    expect((await decided.release()).source).toBe('none')
    await expect(decided.settle({ status: 200, costUsd: 0.01 })).rejects.toThrow(/already settled/)
    expect(api.settles).toHaveLength(1)
  })
})

describe('SolvaPayAgentClient', () => {
  it('posts to /v1/sdk/agent/* with the secret key and throws the status on an error', async () => {
    const seen: { url: string; auth: string | null; body: unknown }[] = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        auth: new Headers(init.headers).get('authorization'),
        body: JSON.parse(String(init.body)),
      })
      return url.endsWith('/settle')
        ? new Response('{"message":"Decision dec_X not found"}', { status: 404 })
        : Response.json({ decisionRef: 'dec_X', action: 'allow' })
    }) as unknown as typeof fetch
    const client = createSolvaPayAgentClient({
      apiBaseUrl: 'http://solvapay.test/',
      secretKey: 'sk_sandbox_x',
      fetchImpl,
    })

    expect(
      (await client.decide({ ...INPUT, kind: 'inference', estimatedCost: '0.1' })).decisionRef,
    ).toBe('dec_X')
    const failed = client.settle({ decisionRef: 'dec_X', source: 'none' })
    await expect(failed).rejects.toBeInstanceOf(AgentApiError)
    await expect(failed).rejects.toMatchObject({ status: 404 })
    expect(seen[0]).toMatchObject({
      url: 'http://solvapay.test/v1/sdk/agent/decide',
      auth: 'Bearer sk_sandbox_x',
    })
    expect(seen[1].url).toBe('http://solvapay.test/v1/sdk/agent/settle')
  })
})
