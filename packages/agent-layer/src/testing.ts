// Test doubles for SolvaPay's side of agent payments: agent tokens signed with
// a local key, the API as `@solvapay/server` sees it, and the agent endpoints.
import { createSolvaPay, type TrackUsageRequest, type TrackUsageResponse } from '@solvapay/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import {
  AgentApiError,
  type ApprovalStatus,
  type ApprovalStatusResponse,
  type DecideInput,
  type DecideResponse,
  type SettleInput,
  type SettleResponse,
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
  } = {},
): Promise<string> {
  const claims: Record<string, unknown> = { scope: overrides.scope ?? 'usage' }
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
 * In-memory stand-in for SolvaPay's agent endpoints (decide, settle, usage
 * reports). Every decision has the action set on `action`; each settle
 * records how many usage rows the credit side had written by then, to check
 * the order. A usage report is answered by `respond`, by default every call
 * matched and nothing flagged.
 */
export class FakeAgentApi implements SolvaPayAgentClient {
  action: 'allow' | 'ask' | 'deny' = 'allow'
  reasonCode = 'within_limits'
  reasonText = 'Within limits.'
  /** An HTTP status for decide to fail with. */
  failDecide: number | null = null
  /** The month's approval to report on every decision, as SolvaPay does while one waits. */
  approval: DecideResponse['approval'] | null = null
  /** What the policy wants for the excerpt; absent from responses while `null`. */
  promptExcerptWanted: boolean | null = null
  /**
   * What each read of an approval's status answers, in order; the last one
   * repeats. Setting it to approved lets the next decide allow, as SolvaPay's
   * extension would.
   */
  statuses: ApprovalStatus[] = ['pending']
  readonly statusReads: string[] = []
  readonly decides: DecideInput[] = []
  readonly settles: (SettleInput & { usagesBefore: number })[] = []
  readonly reports: UsageReport[] = []
  respond: (report: UsageReport) => UsageReportResponse = report => ({
    reference: `urp_TEST${String(this.reports.length).padStart(4, '0')}`,
    duplicate: false,
    results: report.calls.map(call => ({
      decisionRef: call.decisionRef,
      result: 'matched',
      reportedUsd: call.costUsd,
      bookedPolicyUsd: call.costUsd,
      bookedCreditUsd: call.costUsd,
      policyDeltaUsd: '0',
      creditDeltaUsd: '0',
    })),
    untagged: { totalUsd: '0', beforePolicyUsd: '0', flagged: false },
  })
  private next = 1

  constructor(private readonly api?: FakeSolvaPayApi) {}

  async decide(input: DecideInput): Promise<DecideResponse> {
    this.decides.push(input)
    if (this.failDecide !== null) {
      throw new AgentApiError(
        `POST /v1/sdk/agent/decide failed (${this.failDecide})`,
        this.failDecide,
      )
    }
    const decisionRef = `dec_TEST${String(this.next++).padStart(4, '0')}`
    return {
      decisionRef,
      action: this.action,
      reasonCode: this.reasonCode,
      reasonText: this.reasonText,
      policy: { reference: 'pol_TESTPOL1', version: 2 },
      ...(this.action === 'allow'
        ? {
            reservation: {
              amountUsd: input.estimatedCost,
              expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
            },
          }
        : {}),
      budget: {
        spentUsd: '0.10',
        reservedUsd: '0',
        effectiveBudgetUsd: '5',
        ceilingUsd: '12.5',
      },
      ...(this.approval ? { approval: this.approval } : {}),
      ...(this.promptExcerptWanted !== null
        ? { promptExcerptWanted: this.promptExcerptWanted }
        : {}),
    }
  }

  async settle(input: SettleInput): Promise<SettleResponse> {
    this.settles.push({ ...input, usagesBefore: this.api?.usages.length ?? 0 })
    return {
      settled: true,
      duplicate: false,
      policy: { spentPeriodUsd: input.amountUsd ?? '0', spentDayUsd: '0', reservedUsd: '0' },
      flags: input.source === 'provisional' ? ['provisional'] : [],
    }
  }

  async approvalStatus(statusUrl: string): Promise<ApprovalStatusResponse> {
    this.statusReads.push(statusUrl)
    const status = this.statuses[Math.min(this.statusReads.length, this.statuses.length) - 1]
    if (status === 'approved') {
      this.action = 'allow'
      this.reasonCode = 'within_limits'
      this.approval = null
    }
    return {
      reference: statusUrl.split('/').pop() as string,
      status,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    }
  }

  async reportUsage(report: UsageReport): Promise<UsageReportResponse> {
    this.reports.push(report)
    return this.respond(report)
  }
}
