import { describe, expect, it } from 'vitest'
import { createAgentCalls, usdString, type AgentCall, type Allowed } from '../calls'
import { promptFacts } from '../prompt'
import { FakeAgentApi } from '../testing'

function setup(opts: { waitSeconds?: number } = {}) {
  const agentApi = new FakeAgentApi()
  const events: { event: string; fields?: Record<string, unknown> }[] = []
  let clock = 0
  const sleeps: number[] = []
  const calls = createAgentCalls({
    client: agentApi,
    maxWaitSeconds: opts.waitSeconds ?? 0,
    log: {
      info: (event, fields) => events.push({ event, fields }),
      error: (event, fields) => events.push({ event, fields }),
    },
    now: () => clock,
    sleep: async ms => {
      sleeps.push(ms)
      clock += ms
    },
  })
  return { agentApi, calls, events, sleeps, advance: (ms: number) => (clock += ms) }
}

function call(overrides: Partial<AgentCall> = {}): AgentCall {
  return {
    requestId: 'req-1',
    agentToken: 'eyJ.agent.token',
    agent: {
      agentRef: 'agt_TESTAGNT',
      principalRef: 'ppl_ABCDEFGHIJKLMNOP',
      tokenId: 'jti-1',
      expiresAt: new Date(Date.now() + 15 * 60_000),
      promptExcerpt: false,
    },
    item: 'claude-haiku-4-5',
    estimateUsd: '0.005142',
    prompt: null,
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe('createAgentCalls', () => {
  it('authorizes once and completes at the reported cost', async () => {
    const { agentApi, calls } = setup()
    const begun = (await calls.begin(call())) as Allowed

    expect(begun).toMatchObject({ kind: 'allow', callRef: 'call_TEST0001' })
    expect(agentApi.authorizes).toEqual([
      {
        agentToken: 'eyJ.agent.token',
        requestId: 'req-1',
        item: 'claude-haiku-4-5',
        estimatedCost: '0.005142',
        wait: 0,
      },
    ])
    expect(await begun.finish({ status: 200, costUsd: 0.0000407 })).toMatchObject({
      source: 'reported',
      amountUsd: '0.0000407',
    })
    expect(agentApi.completes).toEqual([
      { callRef: 'call_TEST0001', status: 200, costUsd: '0.0000407' },
    ])
  })

  it('sends the prompt facts, and the excerpt only when the token allows it', async () => {
    const { agentApi, calls } = setup()
    const prompt = promptFacts('Summarise this report.')
    await calls.begin(call({ prompt }))
    await calls.begin(
      call({ requestId: 'req-2', prompt, agent: { ...call().agent, promptExcerpt: true } }),
    )
    expect(agentApi.authorizes[0]).toMatchObject({
      promptHash: prompt.promptHash,
      toolError: false,
    })
    expect(agentApi.authorizes[0]).not.toHaveProperty('promptExcerpt')
    expect(agentApi.authorizes[1]).toMatchObject({ promptExcerpt: 'Summarise this report.' })
  })

  it("refuses with SolvaPay's own reason and sentence", async () => {
    const { agentApi, calls } = setup()
    agentApi.outcome = 'refused'
    expect(await calls.begin(call())).toEqual({
      kind: 'refused',
      reason: 'deny',
      message: agentApi.refusal.message,
    })
  })

  it('keeps asking while the owner decides, then goes ahead', async () => {
    const { agentApi, calls, sleeps } = setup({ waitSeconds: 120 })
    agentApi.waitingAnswers = 2
    expect(await calls.begin(call())).toMatchObject({ kind: 'allow', callRef: 'call_TEST0001' })
    expect(agentApi.authorizes.map(a => a.wait)).toEqual([55, 55, 55])
    expect(sleeps).toEqual([1000, 1000])
    // One call: every request carries the same request id.
    expect(new Set(agentApi.authorizes.map(a => a.requestId)).size).toBe(1)
  })

  it('waits no longer than the merchant allows, then refuses with what SolvaPay said', async () => {
    const { agentApi, calls } = setup({ waitSeconds: 2 })
    agentApi.waitingAnswers = 10
    expect(await calls.begin(call())).toEqual({
      kind: 'refused',
      reason: 'approval_timed_out',
      message: agentApi.waitingMessage,
    })
    expect(agentApi.authorizes.map(a => a.wait)).toEqual([2, 1, 0])
  })

  it('refuses as ask at once when the merchant does not hold calls', async () => {
    const { agentApi, calls } = setup({ waitSeconds: 0 })
    agentApi.waitingAnswers = 1
    expect(await calls.begin(call())).toMatchObject({ kind: 'refused', reason: 'ask' })
    expect(agentApi.authorizes).toHaveLength(1)
  })

  it('stops waiting when the caller goes away', async () => {
    const { agentApi, calls } = setup({ waitSeconds: 120 })
    agentApi.waitingAnswers = 5
    const gone = new AbortController()
    gone.abort()
    expect(await calls.begin(call({ signal: gone.signal }))).toMatchObject({
      reason: 'approval_client_closed',
    })
  })

  it('refuses an agent SolvaPay does not accept, and never lets a call through unchecked', async () => {
    const { agentApi, calls } = setup()
    agentApi.failAuthorize = 401
    expect(await calls.begin(call())).toMatchObject({ reason: 'agent_not_accepted' })
    agentApi.failAuthorize = 503
    expect(await calls.begin(call())).toMatchObject({ reason: 'unavailable' })
  })

  it('completes a call that never reached the upstream as a failure, so nothing is charged', async () => {
    const { agentApi, calls } = setup()
    const begun = (await calls.begin(call())) as Allowed
    await begun.release('upstream_unreachable')
    expect(agentApi.completes).toEqual([
      { callRef: 'call_TEST0001', status: 502, costUsd: null, interrupted: 'upstream_unreachable' },
    ])
  })

  it('logs a complete SolvaPay could not take, and completes a call once', async () => {
    const { agentApi, calls, events } = setup()
    agentApi.failComplete = 503
    const begun = (await calls.begin(call())) as Allowed
    expect(await begun.finish({ status: 200, costUsd: null })).toBeNull()
    expect(events.map(e => e.event)).toContain('call.complete_failed')
    await expect(begun.finish({ status: 200, costUsd: null })).rejects.toThrow('already completed')
  })
})

describe('usdString', () => {
  it('writes a cost with up to 8 places and no float noise', () => {
    expect(usdString(0.0000407)).toBe('0.0000407')
    expect(usdString(0.1 + 0.2)).toBe('0.3')
    expect(usdString(0)).toBe('0')
  })
})
