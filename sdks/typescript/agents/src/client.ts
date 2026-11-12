// SolvaPay's agent endpoints, called with the merchant's secret key: authorize
// before a paid call, complete after it, and usage reports for reconciliation.
// Everything between runs in SolvaPay (DEV-1126); this is transport and types.
// Each answer is read strictly by the Rust core (`parseAgentResponse`).
import { agentSecretKeyEnvironment, parseAgentResponse, unwrap } from './core'

/** Why SolvaPay refused a call; the sentence for the human comes with it. */
export const SERVER_REFUSAL_REASONS = [
  'customer_not_linked',
  'ask',
  'deny',
  'topup_required',
  'approval_declined',
  'approval_expired',
] as const
export type ServerRefusalReason = (typeof SERVER_REFUSAL_REASONS)[number]

/**
 * Money on the wire: a decimal amount with up to 8 places and its ISO 4217
 * currency, always together (DEV-1129). SolvaPay counts credits in USD and
 * refuses a currency it can't price yet (`currency_not_supported`).
 */
export interface MoneyAmount {
  amount: string
  currency: string
}

export interface AuthorizeInput {
  /** The agent token the call came with; SolvaPay verifies it again. */
  agentToken: string
  /** The merchant's id for the call; a repeat continues the same call. */
  requestId: string
  /** The merchant's own label for what is used, at most 200 characters (a model id, a tool name). */
  item?: string
  /** What this call may cost, in the merchant's currency. */
  estimate: MoneyAmount
  /** `sha256:` over the call's prompt; repeats of it show loops. */
  promptHash?: string
  /** The prompt carries a tool result marked as an error. */
  toolError?: boolean
  /** The end of the prompt, only when the agent token allows it (`px`). */
  promptExcerpt?: string
  /** Seconds this request may hold while the owner decides, 0 to 55. */
  wait: number
}

/** What SolvaPay answers: go ahead, refused with why, or still waiting for the owner. */
export type AuthorizeResponse =
  | {
      status: 'allowed'
      callRef: string
      reservation: { held: MoneyAmount; expiresAt: string }
    }
  | { status: 'refused'; callRef: string; reason: ServerRefusalReason; message: string }
  | {
      status: 'waiting'
      callRef: string
      message: string
      approval: { reference: string; expiresAt: string }
      retryAfterSeconds: number
    }

/** The longest one authorize request may hold; a longer wait is a series of requests. */
export const AUTHORIZE_WAIT_MAX_SECONDS = 55

export interface CompleteInput {
  /** The status the upstream answered with. */
  status: number
  /** The cost the upstream reported, in its currency; `null` when none arrived. */
  cost: MoneyAmount | null
  /** Set when the answer broke before it finished, with why. */
  interrupted?: string
}

export interface CompleteResponse {
  callRef: string
  /** `false` when nothing was charged (the upstream answered an error). */
  settled: boolean
  source: 'reported' | 'provisional' | 'none'
  /** What was settled, in USD credits. */
  amount: MoneyAmount
  duplicate: boolean
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
  /** The currency every cost below is in: one upstream bills in one currency. */
  currency: string
  /** Decimal strings with up to 8 places, by the call reference authorize returned. */
  calls: { callRef: string; cost: string }[]
  untagged: { at: string; cost: string }[]
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

/** One call of a usage report, as SolvaPay reconciled it (build plan §7m, decision 3). */
export interface ReconciledCall {
  /** Absent only for a call SolvaPay does not know, which is `ignored`. */
  callRef?: string
  result: ReconciliationResult
  reason?: ReconciliationReason
  /** Absent for `ignored`. */
  reported?: string
  bookedPolicy?: string
  bookedCredit?: string
  policyDelta?: string
  creditDelta?: string
}

export interface UsageReportResponse {
  /** SolvaPay's record of the report (`urp_…`). */
  reference: string
  /** The currency of every amount below: credits are counted in USD. */
  currency: string
  /** The report id was seen before; the first report's results are returned. */
  duplicate: boolean
  results: ReconciledCall[]
  /** Usage without a decision; `flagged` when some of it came after the spend policy. */
  untagged: { total: string; beforePolicy: string; flagged: boolean }
}

/** Prefix of an agent key: long-lived, for one merchant, sent in place of an agent token. */
export const AGENT_KEY_PREFIX = 'agk_'

/** Where an agent spends: sandbox agents at sandbox merchants, live at live. */
export const AGENT_ENVIRONMENTS = ['sandbox', 'live'] as const
export type AgentEnvironment = (typeof AGENT_ENVIRONMENTS)[number]

/** The environment a merchant secret key is for, `undefined` when its prefix doesn't say. */
export function secretKeyEnvironment(secretKey: string): AgentEnvironment | undefined {
  const environment = agentSecretKeyEnvironment(secretKey)
  return environment === null ? undefined : (environment as AgentEnvironment)
}

/** The agent behind an agent key, as SolvaPay answers for this merchant. */
export interface VerifiedAgentKey {
  agentRef: string
  /** Pairwise reference of the account at this merchant, `ppl_…`. */
  principalRef: string
  /** The agent's spend policy lets the classifier read the end of the prompt. */
  promptExcerpt: boolean
  /** Where the agent spends. */
  environment: AgentEnvironment
}

export interface SolvaPayAgentClient {
  /** 401 for an unknown or revoked key, 403 for another merchant's or the other environment's. */
  verifyAgentKey(agentKey: string): Promise<VerifiedAgentKey>
  authorize(input: AuthorizeInput): Promise<AuthorizeResponse>
  complete(callRef: string, input: CompleteInput): Promise<CompleteResponse>
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

  async function post<T>(path: string, body: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new AgentApiError(`POST ${path} failed (${response.status}): ${text}`, response.status)
    }
    return JSON.parse(text) as T
  }

  return {
    verifyAgentKey: async agentKey =>
      parseVerifiedAgentKey(await post<unknown>('/v1/sdk/agent/keys/verifications', { agentKey })),
    // A held request answers when the owner does or its wait ends, so it may take that long.
    authorize: async input =>
      parseAuthorizeResponse(
        await post<unknown>('/v1/sdk/agent/calls', input, input.wait * 1000 + TIMEOUT_MS),
      ),
    complete: async (callRef, input) =>
      parseCompleteResponse(
        await post<unknown>(`/v1/sdk/agent/calls/${encodeURIComponent(callRef)}/complete`, input),
      ),
    reportUsage: async body =>
      parseUsageReportResponse(await post<unknown>('/v1/sdk/agent/usage-reports', body)),
  }
}

/** Checked field by field: the agent is served on it. */
export function parseVerifiedAgentKey(value: unknown): VerifiedAgentKey {
  return unwrap<VerifiedAgentKey>(parseAgentResponse('verifiedKey', value))
}

/** Checked field by field: a paid call goes ahead on it, so a misread must throw. */
export function parseAuthorizeResponse(value: unknown): AuthorizeResponse {
  return unwrap<AuthorizeResponse>(parseAgentResponse('authorize', value))
}

/** Checked field by field: the call's books are settled on it. */
export function parseCompleteResponse(value: unknown): CompleteResponse {
  return unwrap<CompleteResponse>(parseAgentResponse('complete', value))
}

/** Checked field by field: a merchant acts on `flagged`, so a misread must throw. */
export function parseUsageReportResponse(value: unknown): UsageReportResponse {
  return unwrap<UsageReportResponse>(parseAgentResponse('usageReport', value))
}
