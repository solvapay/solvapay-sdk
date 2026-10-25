import { describe, expect, it } from 'vitest'
import { createApprovalWait } from '../approval-wait'
import { createAgentCalls, type AgentCall, type Allowed } from '../calls'
import { createMetering } from '../metering'
import { createPolicy } from '../policy'
import { FakeAgentApi, FakeSolvaPayApi } from '../testing'

const PRINCIPAL = 'ppl_ABCDEFGHIJKLMNOP'
const APPROVAL = {
  reference: 'apr_TEST0001',
  status: 'pending' as const,
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  statusUrl: 'https://api.solvapay.test/v1/sdk/agent/approvals/apr_TEST0001',
}

function setup(opts: { waitSeconds?: number } = {}) {
  const api = new FakeSolvaPayApi()
  const agentApi = new FakeAgentApi(api)
  const events: { event: string; fields?: Record<string, unknown> }[] = []
  const calls = createAgentCalls({
    metering: createMetering({ solvaPay: api.solvaPay(), productRef: 'prd_TEST' }),
    policy: createPolicy({ client: agentApi }),
    approvalWait: createApprovalWait({
      client: agentApi,
      maxSeconds: opts.waitSeconds ?? 0,
      pollMs: 1,
    }),
    log: {
      info: (event, fields) => events.push({ event, fields }),
      error: (event, fields) => events.push({ event, fields }),
    },
  })
  return { api, agentApi, calls, events }
}

function call(overrides: Partial<AgentCall> = {}): AgentCall {
  return {
    request: new Request('http://merchant.test/mcp', { method: 'POST' }),
    requestId: 'req-1',
    agentToken: 'eyJ.agent.token',
    agent: {
      agentRef: 'agt_TESTAGNT',
      principalRef: PRINCIPAL,
      tokenId: 'jti-1',
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
    item: 'ask_opper',
    estimateUsd: '0.05',
    prompt: null,
    signal: new AbortController().signal,
    logFields: { tool: 'ask_opper' },
    ...overrides,
  }
}

function allowed(outcome: Awaited<ReturnType<ReturnType<typeof setup>['calls']['begin']>>) {
  if (outcome.kind !== 'allow') throw new Error(`expected allow, got ${outcome.reason}`)
  return outcome as Allowed
}

describe('agent calls', () => {
  it('allows a call within the policy and the balance, then settles the policy before the credits at the reported cost', async () => {
    const { api, agentApi, calls } = setup()
    const outcome = allowed(await calls.begin(call()))
    expect(agentApi.decides[0]).toMatchObject({ requestId: 'req-1', item: 'ask_opper' })

    const finished = await outcome.finish({ status: 200, costUsd: 0.0123 })
    expect(agentApi.settles).toEqual([
      { decisionRef: 'dec_TEST0001', source: 'reported', amountUsd: '0.0123', usagesBefore: 0 },
    ])
    expect(api.usages).toHaveLength(1)
    expect(api.usages[0]).toMatchObject({
      customerRef: 'cus_TESTCUST',
      cost: { amount: '0.0123', source: 'reported' },
      metadata: {
        decision_ref: 'dec_TEST0001',
        agent_id: 'agt_TESTAGNT',
        policy_id: 'pol_TESTPOL1',
      },
    })
    expect(finished.policySettled?.source).toBe('reported')
    expect(finished.settled).toMatchObject({ settled: true, source: 'reported' })
  })

  it('settles at the estimate, marked provisional, when no cost was reported', async () => {
    const { api, agentApi, calls } = setup()
    const outcome = allowed(await calls.begin(call()))
    await outcome.finish({ status: 200, costUsd: null })
    expect(agentApi.settles[0]).toMatchObject({ source: 'provisional', amountUsd: '0.05' })
    expect(api.usages[0]).toMatchObject({ cost: { amount: '0.05', source: 'provisional' } })
  })

  it('releases the reservation and debits nothing when the work never ran', async () => {
    const { api, agentApi, calls } = setup()
    const outcome = allowed(await calls.begin(call()))
    await outcome.release()
    expect(agentApi.settles).toEqual([
      { decisionRef: 'dec_TEST0001', source: 'none', usagesBefore: 0 },
    ])
    expect(api.usages).toHaveLength(0)
  })

  it('refuses an agent whose account has no customer at the merchant, before deciding', async () => {
    const { api, agentApi, calls, events } = setup()
    api.customers.clear()
    const outcome = await calls.begin(call())
    expect(outcome).toEqual({
      kind: 'refused',
      reason: 'customer_not_linked',
      message:
        'This agent has no payment set up with this merchant. Connect it in SolvaPay, then retry.',
    })
    expect(agentApi.decides).toHaveLength(0)
    expect(events.find(e => e.event === 'call.refused')?.fields).toMatchObject({
      reason: 'customer_not_linked',
      tool: 'ask_opper',
      agentRef: 'agt_TESTAGNT',
    })
  })

  it.each(['deny', 'ask'] as const)(
    'refuses a %s with the policy reason for the human, and gates nothing',
    async action => {
      const { api, agentApi, calls } = setup()
      agentApi.action = action
      agentApi.reasonCode = 'budget_exhausted_ask'
      agentApi.reasonText = 'Over this month’s budget. Your owner has been asked.'
      const outcome = await calls.begin(call())
      expect(outcome).toEqual({
        kind: 'refused',
        reason: action,
        message: 'Over this month’s budget. Your owner has been asked.',
      })
      expect(api.usages).toHaveLength(0)
    },
  )

  it('refuses a call the balance does not cover, releases the reservation and names a pending approval', async () => {
    const { api, agentApi, calls } = setup()
    api.credits = 100 // 0.01 USD, under the 0.05 estimate
    agentApi.approval = APPROVAL
    const outcome = await calls.begin(call())
    expect(outcome).toMatchObject({ kind: 'refused', reason: 'topup_required' })
    if (outcome.kind !== 'refused') throw new Error('expected a refusal')
    expect(outcome.message).toMatch(
      /below the 0\.05 USD one call may cost\. Top up to continue\. Approval apr_TEST0001 for more budget is waiting for your owner\.$/,
    )
    expect(agentApi.settles).toEqual([
      { decisionRef: 'dec_TEST0001', source: 'none', usagesBefore: 0 },
    ])
  })

  it('holds an ask with a pending approval, then decides again with its own request id once approved', async () => {
    const { agentApi, calls, events } = setup({ waitSeconds: 60 })
    agentApi.action = 'ask'
    agentApi.approval = APPROVAL
    agentApi.statuses = ['pending', 'approved']
    const outcome = allowed(await calls.begin(call()))
    expect(agentApi.decides.map(d => d.requestId)).toEqual(['req-1', 'req-1:after-apr_TEST0001'])
    expect(outcome.decided.decisionRef).toBe('dec_TEST0002')
    expect(events.find(e => e.event === 'call.held')?.fields).toMatchObject({
      approvalRef: 'apr_TEST0001',
      tool: 'ask_opper',
    })
    expect(events.find(e => e.event === 'call.approval_wait')?.fields).toMatchObject({
      outcome: 'approved',
    })
  })

  it.each([
    [
      'declined',
      'approval_declined',
      'Your owner declined approval apr_TEST0001 for more budget this month.',
    ],
    [
      'expired',
      'approval_expired',
      'Approval apr_TEST0001 for more budget expired before your owner answered. Retry to ask again.',
    ],
  ] as const)('refuses a held call whose approval was %s', async (status, reason, message) => {
    const { agentApi, calls } = setup({ waitSeconds: 60 })
    agentApi.action = 'ask'
    agentApi.approval = APPROVAL
    agentApi.statuses = [status]
    expect(await calls.begin(call())).toEqual({ kind: 'refused', reason, message })
    expect(agentApi.decides).toHaveLength(1)
  })

  it('refuses a held call when the hold runs out with the approval still waiting', async () => {
    const { agentApi, calls } = setup({ waitSeconds: 0.01 })
    agentApi.action = 'ask'
    agentApi.approval = APPROVAL
    const outcome = await calls.begin(call())
    expect(outcome).toEqual({
      kind: 'refused',
      reason: 'approval_timed_out',
      message:
        'Approval apr_TEST0001 for more budget is still waiting for your owner. Retry once they answer.',
    })
  })

  it('stops holding when the caller goes away', async () => {
    const { agentApi, calls } = setup({ waitSeconds: 60 })
    agentApi.action = 'ask'
    agentApi.approval = APPROVAL
    const gone = new AbortController()
    gone.abort()
    expect(await calls.begin(call({ signal: gone.signal }))).toMatchObject({
      kind: 'refused',
      reason: 'approval_client_closed',
    })
  })

  it.each([401, 403])(
    'refuses an agent SolvaPay no longer accepts on decide (%i): revoked, or for another merchant',
    async status => {
      const { agentApi, calls } = setup()
      agentApi.failDecide = status
      expect(await calls.begin(call())).toEqual({
        kind: 'refused',
        reason: 'agent_not_accepted',
        message: 'SolvaPay did not accept this agent (revoked or not for this merchant).',
      })
    },
  )

  it('refuses as unavailable, never lets through, when SolvaPay cannot decide', async () => {
    const { agentApi, calls, events } = setup()
    agentApi.failDecide = 503
    expect(await calls.begin(call())).toEqual({
      kind: 'refused',
      reason: 'unavailable',
      message: 'Spend policy check is unavailable. Try again shortly.',
    })
    expect(events.find(e => e.event === 'call.decide_failed')?.fields).toMatchObject({
      status: 503,
      item: 'ask_opper',
    })
  })
})
