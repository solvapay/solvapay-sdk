// SolvaPay's agent endpoints, called with the merchant's secret key. The SDK
// has no generic request yet, so this is a small REST client of its own
// (prototype spec §2.1 rule 4); it moves into `@solvapay/server` at promotion.
import type { ModelTier } from './pricing'

export interface DecideInput {
  /** The agent token the call came with; SolvaPay verifies it again. */
  agentToken: string
  /** The clone's id for the call; a repeat returns the first decision. */
  requestId: string
  kind: 'inference'
  model: string
  tier: ModelTier
  /** USD decimal string. */
  estimatedCost: string
}

export type DecisionAction = 'allow' | 'ask' | 'deny'

export interface DecideResponse {
  decisionRef: string
  action: DecisionAction
  reasonCode: string
  reasonText: string
  policy?: { reference: string; version: number }
  reservation?: { amountUsd: string; expiresAt: string }
  budget?: {
    spentUsd: string
    reservedUsd: string
    effectiveBudgetUsd: string
    ceilingUsd: string
  }
  /**
   * The spend policy's approval this month, while one is waiting for the
   * owner or a decline holds. Its status URL grants nothing.
   */
  approval?: DecideApproval
}

export interface DecideApproval {
  reference: string
  status: 'pending' | 'declined'
  expiresAt: string
  statusUrl: string
}

export type PolicySettleSource = 'reported' | 'provisional' | 'none'

export interface SettleInput {
  decisionRef: string
  /** Required unless the source is `none`. */
  amountUsd?: string
  source: PolicySettleSource
}

export interface SettleResponse {
  settled: true
  duplicate: boolean
  policy: { spentPeriodUsd: string; spentDayUsd: string; reservedUsd: string }
  flags: string[]
}

export interface SolvaPayAgentClient {
  decide(input: DecideInput): Promise<DecideResponse>
  settle(input: SettleInput): Promise<SettleResponse>
}

export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AgentApiError'
  }
}

const TIMEOUT_MS = 10_000

export function createSolvaPayAgentClient(options: {
  apiBaseUrl: string
  secretKey: string
  fetchImpl?: typeof fetch
}): SolvaPayAgentClient {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.apiBaseUrl.replace(/\/+$/, '')

  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new AgentApiError(`POST ${path} failed (${response.status}): ${text}`, response.status)
    }
    return JSON.parse(text) as T
  }

  return {
    decide: input => post<DecideResponse>('/v1/sdk/agent/decide', input),
    settle: input => post<SettleResponse>('/v1/sdk/agent/settle', input),
  }
}
