// SolvaPay's agent endpoints, called with the merchant's secret key: authorize
// before a paid call, complete after it, and usage reports for reconciliation.
// Everything between runs in SolvaPay (DEV-1126); this is transport and types.
import { isRecord, requireBoolean, requireInteger, requireString } from './guards'

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

export interface SolvaPayAgentClient {
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

/** Checked field by field: a paid call goes ahead on it, so a misread must throw. */
export function parseAuthorizeResponse(value: unknown): AuthorizeResponse {
  if (!isRecord(value)) throw new Error('Authorize response was not an object')
  const callRef = requireString(value.callRef, 'callRef')
  const status = requireString(value.status, 'status')
  if (status === 'allowed') {
    if (!isRecord(value.reservation)) throw new Error('reservation must be an object')
    return {
      status,
      callRef,
      reservation: {
        held: parseMoney(value.reservation.held, 'reservation.held'),
        expiresAt: requireString(value.reservation.expiresAt, 'reservation.expiresAt'),
      },
    }
  }
  if (status === 'refused') {
    return {
      status,
      callRef,
      reason: requireOneOf(SERVER_REFUSAL_REASONS, value.reason, 'reason'),
      message: requireString(value.message, 'message'),
    }
  }
  if (status === 'waiting') {
    if (!isRecord(value.approval)) throw new Error('approval must be an object')
    return {
      status,
      callRef,
      message: requireString(value.message, 'message'),
      approval: {
        reference: requireString(value.approval.reference, 'approval.reference'),
        expiresAt: requireString(value.approval.expiresAt, 'approval.expiresAt'),
      },
      retryAfterSeconds: requireInteger(value.retryAfterSeconds, 'retryAfterSeconds'),
    }
  }
  throw new Error(`Authorize status "${status}" is not allowed, refused or waiting`)
}

/** Checked field by field: the call's books are settled on it. */
export function parseCompleteResponse(value: unknown): CompleteResponse {
  if (!isRecord(value)) throw new Error('Complete response was not an object')
  return {
    callRef: requireString(value.callRef, 'callRef'),
    settled: requireBoolean(value.settled, 'settled'),
    source: requireOneOf(['reported', 'provisional', 'none'] as const, value.source, 'source'),
    amount: parseMoney(value.amount, 'amount'),
    duplicate: requireBoolean(value.duplicate, 'duplicate'),
  }
}

/** Checked field by field: a merchant acts on `flagged`, so a misread must throw. */
export function parseUsageReportResponse(value: unknown): UsageReportResponse {
  if (!isRecord(value)) throw new Error('Usage report response was not an object')
  if (!Array.isArray(value.results)) throw new Error('Usage report results must be a list')
  if (!isRecord(value.untagged)) throw new Error('Usage report untagged must be an object')
  return {
    reference: requireString(value.reference, 'reference'),
    currency: requireString(value.currency, 'currency'),
    duplicate: requireBoolean(value.duplicate, 'duplicate'),
    results: value.results.map(parseReconciledCall),
    untagged: {
      total: requireString(value.untagged.total, 'untagged.total'),
      beforePolicy: requireString(value.untagged.beforePolicy, 'untagged.beforePolicy'),
      flagged: requireBoolean(value.untagged.flagged, 'untagged.flagged'),
    },
  }
}

function parseReconciledCall(value: unknown): ReconciledCall {
  if (!isRecord(value)) throw new Error('Usage report result was not an object')
  const result = requireOneOf(RECONCILIATION_RESULTS, value.result, 'result')
  const optional = (field: string) =>
    value[field] === undefined || value[field] === null
      ? {}
      : { [field]: requireString(value[field], field) }
  return {
    ...optional('callRef'),
    result,
    ...(value.reason === undefined || value.reason === null
      ? {}
      : { reason: requireOneOf(RECONCILIATION_REASONS, value.reason, 'reason') }),
    ...optional('reported'),
    ...optional('bookedPolicy'),
    ...optional('bookedCredit'),
    ...optional('policyDelta'),
    ...optional('creditDelta'),
  }
}

function requireOneOf<T extends string>(allowed: readonly T[], value: unknown, label: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${label} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`)
  }
  return value as T
}

/** An amount and its currency, both required. */
function parseMoney(value: unknown, label: string): MoneyAmount {
  if (!isRecord(value)) throw new Error(`${label} must be an object with amount and currency`)
  return {
    amount: requireString(value.amount, `${label}.amount`),
    currency: requireString(value.currency, `${label}.currency`),
  }
}
