// Test doubles for SolvaPay's side of agent payments: agent tokens signed with
// a local key, the API as `@solvapay/server` sees it (customers, for a
// merchant's own reads), and the agent endpoints (authorize, complete, usage
// reports).
import { createSolvaPay, type TrackUsageRequest, type TrackUsageResponse } from '@solvapay/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import {
  AgentApiError,
  type AuthorizeInput,
  type AuthorizeResponse,
  type CompleteInput,
  type CompleteResponse,
  type ServerRefusalReason,
  type SolvaPayAgentClient,
  type UsageReport,
  type UsageReportResponse,
} from './client'

/** SolvaPay agent token test fixtures. */
export const ISSUER = 'https://api.solvapay.test/v1/agent'
export const PROVIDER = 'prov_W3TLPNOA'

export async function agentKeys() {
  const pair = await generateKeyPair('ES256', { extractable: true })
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
  return { privateKey: pair.privateKey, publicJwk: jwk }
}

export function signAgentToken(
  key: CryptoKey,
  overrides: {
    iss?: string
    aud?: string
    sub?: string
    principal?: string | null
    scope?: string
    expiresIn?: string
    kid?: string
    /** The owner lets the classifier read the prompt's end (`px`). */
    promptExcerpt?: boolean
  } = {},
): Promise<string> {
  const claims: Record<string, unknown> = { scope: overrides.scope ?? 'usage' }
  if (overrides.promptExcerpt) claims.px = true
  if (overrides.principal !== null) claims.principal = overrides.principal ?? 'ppl_ABCDEFGHIJKLMNOP'
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: overrides.kid ?? 'k1' })
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? PROVIDER)
    .setSubject(overrides.sub ?? 'agt_TESTAGNT')
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? '15m')
    .sign(key)
}

/**
 * In-memory stand-in for SolvaPay's API, as `@solvapay/server` sees it: one
 * linked customer with a balance, and the usage events it receives.
 */
export class FakeSolvaPayApi {
  /** principal (externalRef) → customer reference */
  readonly customers = new Map<string, string>([['ppl_ABCDEFGHIJKLMNOP', 'cus_TESTCUST']])
  credits = 30_000
  balanceUsd = '3'
  readonly usages: TrackUsageRequest[] = []
  readonly lookups: string[] = []

  async getCustomer(params: { externalRef?: string }) {
    this.lookups.push(params.externalRef ?? '')
    const customerRef = params.externalRef ? this.customers.get(params.externalRef) : undefined
    if (!customerRef) {
      // As the SDK client throws for a 404: a SolvaPayError carrying the status.
      throw Object.assign(new Error(`Get customer failed (404): not found`), { status: 404 })
    }
    return { customerRef, email: '', externalRef: params.externalRef, purchases: [] }
  }

  async getCustomerBalance(params: { customerRef: string }) {
    return {
      customerRef: params.customerRef,
      credits: this.credits,
      creditsPerMinorUnit: 100,
      displayCurrency: 'USD',
      displayExchangeRate: 1,
      display: {
        amountMajor: this.credits / 10_000,
        currency: 'USD',
        exchangeRate: 1,
        formatted: '',
        rateSource: 'parity' as const,
      },
    }
  }

  async trackUsage(params: TrackUsageRequest): Promise<TrackUsageResponse> {
    this.usages.push(params)
    const amount = params.cost?.amount ?? '0'
    return {
      success: true,
      reference: `usage_${this.usages.length}`,
      creditDebit: {
        debited: true,
        costSource: params.cost?.source ?? 'reported',
        amount: 0,
        amountUsd: amount,
        balanceCredits: this.credits,
        balanceUsd: this.balanceUsd,
      },
    }
  }

  async checkLimits(): Promise<never> {
    throw new Error('cost mode never calls /limits')
  }

  async createCheckoutSession(): Promise<never> {
    throw new Error('not used')
  }

  async createCustomerSession(): Promise<never> {
    throw new Error('not used')
  }

  solvaPay() {
    return createSolvaPay({ apiClient: this })
  }
}

/**
 * In-memory stand-in for SolvaPay's agent endpoints. Each authorize answers
 * by `outcome`: allowed, refused with `refusal`, or waiting for the owner
 * `waitingAnswers` times before allowing (`approve`) or refusing. A complete
 * is recorded and answered as SolvaPay settles it. A usage report is answered
 * by `respond`, by default every call matched and nothing flagged.
 */
export class FakeAgentApi implements SolvaPayAgentClient {
  outcome: 'allowed' | 'refused' = 'allowed'
  refusal: { reason: ServerRefusalReason; message: string } = {
    reason: 'deny',
    message: 'This call could cost about $0.31, over the per-call cap of $0.25.',
  }
  /** How many authorize answers say `waiting` before `outcome` applies. */
  waitingAnswers = 0
  waitingMessage = 'Approval apr_TESTAPR1 for more budget is waiting for your owner.'
  /** An HTTP status for authorize to fail with. */
  failAuthorize: number | null = null
  /** An HTTP status for complete to fail with. */
  failComplete: number | null = null
  readonly authorizes: AuthorizeInput[] = []
  readonly completes: (CompleteInput & { callRef: string })[] = []
  readonly reports: UsageReport[] = []
  respond: (report: UsageReport) => UsageReportResponse = report => ({
    reference: `urp_TEST${String(this.reports.length).padStart(4, '0')}`,
    duplicate: false,
    results: report.calls.map(call => ({
      callRef: call.callRef,
      result: 'matched',
      reportedUsd: call.costUsd,
      bookedPolicyUsd: call.costUsd,
      bookedCreditUsd: call.costUsd,
      policyDeltaUsd: '0',
      creditDeltaUsd: '0',
    })),
    untagged: { totalUsd: '0', beforePolicyUsd: '0', flagged: false },
  })
  /** request id → call reference, as SolvaPay keys a call on the merchant's id. */
  private readonly calls = new Map<string, string>()

  async authorize(input: AuthorizeInput): Promise<AuthorizeResponse> {
    this.authorizes.push(input)
    if (this.failAuthorize !== null) {
      throw new AgentApiError(
        `POST /v1/sdk/agent/calls failed (${this.failAuthorize})`,
        this.failAuthorize,
      )
    }
    const callRef =
      this.calls.get(input.requestId) ?? `call_TEST${String(this.calls.size + 1).padStart(4, '0')}`
    this.calls.set(input.requestId, callRef)
    if (this.waitingAnswers > 0) {
      this.waitingAnswers -= 1
      return {
        status: 'waiting',
        callRef,
        message: this.waitingMessage,
        approval: {
          reference: 'apr_TESTAPR1',
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        },
        retryAfterSeconds: 1,
      }
    }
    if (this.outcome === 'refused') return { status: 'refused', callRef, ...this.refusal }
    return {
      status: 'allowed',
      callRef,
      reservation: {
        amountUsd: input.estimatedCost,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    }
  }

  async complete(callRef: string, input: CompleteInput): Promise<CompleteResponse> {
    this.completes.push({ callRef, ...input })
    if (this.failComplete !== null) {
      throw new AgentApiError(
        `POST /v1/sdk/agent/calls/${callRef}/complete failed (${this.failComplete})`,
        this.failComplete,
      )
    }
    const source =
      input.status >= 400 ? 'none' : input.costUsd !== null ? 'reported' : 'provisional'
    return {
      callRef,
      settled: source !== 'none',
      source,
      amountUsd: source === 'reported' ? (input.costUsd as string) : '0',
      duplicate: false,
    }
  }

  async reportUsage(report: UsageReport): Promise<UsageReportResponse> {
    this.reports.push(report)
    return this.respond(report)
  }
}
