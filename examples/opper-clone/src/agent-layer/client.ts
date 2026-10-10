// SolvaPay's agent endpoints, called with the merchant's secret key. The SDK
// has no generic request yet, so this is a small REST client of its own
// (prototype spec §2.1 rule 4); it moves into `@solvapay/server` at promotion.
import { isRecord, requireBoolean, requireString } from '../lib/guards'

export interface DecideInput {
  /** The agent token the call came with; SolvaPay verifies it again. */
  agentToken: string
  /** The clone's id for the call; a repeat returns the first decision. */
  requestId: string
  kind: 'usage'
  /** The merchant's own label for what is used, at most 200 characters; the clone sends the model id. */
  item?: string
  /** USD decimal string. */
  estimatedCost: string
  /** `sha256:` over the call's last user turn; repeats of it show loops. */
  promptHash?: string
  /** The last user turn carries a tool result marked as an error. */
  toolError?: boolean
  /** The end of the last user turn, only once SolvaPay said the policy wants it. */
  promptExcerpt?: string
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
  /** Whether the spend policy wants the prompt excerpt with this agent's next calls. */
  promptExcerptWanted?: boolean
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

/**
 * The merchant's usage for one customer and window (build plan §7m, decision 2):
 * `calls` is complete for the window, `untagged` the usage without a decision.
 */
export interface UsageReport {
  /** The merchant's id for the report; a repeat returns the first report's results. */
  reportId: string
  customerRef: string
  /** Where the merchant read its usage, for example `opper:/v2/analytics/usage`. */
  source: string
  /** ISO 8601, `[from, to)`, in decision times. */
  window: { from: string; to: string }
  /** USD decimal strings with up to 8 places. */
  calls: { decisionRef: string; costUsd: string }[]
  untagged: { at: string; costUsd: string }[]
}

export const RECONCILIATION_RESULTS = [
  'matched',
  'adjusted',
  'pending',
  'already_reconciled',
  'ignored',
] as const
export type ReconciliationResult = (typeof RECONCILIATION_RESULTS)[number]

export const RECONCILIATION_REASONS = [
  'provisional',
  'expired',
  'no_debit',
  'cost_differs',
] as const
export type ReconciliationReason = (typeof RECONCILIATION_REASONS)[number]

/** One decision of a usage report, as SolvaPay reconciled it (build plan §7m, decision 3). */
export interface ReconciledCall {
  decisionRef: string
  result: ReconciliationResult
  reason?: ReconciliationReason
  reportedUsd: string
  bookedPolicyUsd: string
  bookedCreditUsd: string
  policyDeltaUsd: string
  creditDeltaUsd: string
}

export interface UsageReportResponse {
  /** SolvaPay's record of the report (`urp_…`). */
  reference: string
  /** The report id was seen before; the first report's results are returned. */
  duplicate: boolean
  results: ReconciledCall[]
  /** Usage without a decision; `flagged` when some of it came after the spend policy. */
  untagged: { totalUsd: string; beforePolicyUsd: string; flagged: boolean }
}

export interface SolvaPayAgentClient {
  decide(input: DecideInput): Promise<DecideResponse>
  settle(input: SettleInput): Promise<SettleResponse>
  reportUsage(body: UsageReport): Promise<UsageReportResponse>
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
    reportUsage: async body =>
      parseUsageReportResponse(await post<unknown>('/v1/sdk/agent/usage-reports', body)),
  }
}

/** Checked field by field: the clone rotates a key on `flagged`, so a misread must throw. */
export function parseUsageReportResponse(value: unknown): UsageReportResponse {
  if (!isRecord(value)) throw new Error('Usage report response was not an object')
  if (!Array.isArray(value.results)) throw new Error('Usage report results must be a list')
  if (!isRecord(value.untagged)) throw new Error('Usage report untagged must be an object')
  return {
    reference: requireString(value.reference, 'reference'),
    duplicate: requireBoolean(value.duplicate, 'duplicate'),
    results: value.results.map(parseReconciledCall),
    untagged: {
      totalUsd: requireString(value.untagged.totalUsd, 'untagged.totalUsd'),
      beforePolicyUsd: requireString(value.untagged.beforePolicyUsd, 'untagged.beforePolicyUsd'),
      flagged: requireBoolean(value.untagged.flagged, 'untagged.flagged'),
    },
  }
}

function parseReconciledCall(value: unknown): ReconciledCall {
  if (!isRecord(value)) throw new Error('Usage report result was not an object')
  const result = requireOneOf(RECONCILIATION_RESULTS, value.result, 'result')
  return {
    decisionRef: requireString(value.decisionRef, 'decisionRef'),
    result,
    ...(value.reason === undefined || value.reason === null
      ? {}
      : { reason: requireOneOf(RECONCILIATION_REASONS, value.reason, 'reason') }),
    reportedUsd: requireString(value.reportedUsd, 'reportedUsd'),
    bookedPolicyUsd: requireString(value.bookedPolicyUsd, 'bookedPolicyUsd'),
    bookedCreditUsd: requireString(value.bookedCreditUsd, 'bookedCreditUsd'),
    policyDeltaUsd: requireString(value.policyDeltaUsd, 'policyDeltaUsd'),
    creditDeltaUsd: requireString(value.creditDeltaUsd, 'creditDeltaUsd'),
  }
}

function requireOneOf<T extends string>(allowed: readonly T[], value: unknown, label: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${label} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`)
  }
  return value as T
}
