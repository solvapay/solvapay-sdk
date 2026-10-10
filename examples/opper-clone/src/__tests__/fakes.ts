import { createSolvaPay, type TrackUsageRequest, type TrackUsageResponse } from '@solvapay/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import {
  AgentApiError,
  type DecideInput,
  type DecideResponse,
  type SettleInput,
  type SettleResponse,
  type SolvaPayAgentClient,
  type UsageReport,
  type UsageReportResponse,
} from '../agent-layer/client'
import type {
  MintedKey,
  OpperManagement,
  OpperProject,
  ProjectSpend,
  UsageQuery,
  UsageRow,
} from '../merchant/opper-client'

/** In-memory stand-in for Opper's Management API. */
export class FakeOpperManagement implements OpperManagement {
  readonly projects = new Map<string, OpperProject>()
  readonly keys = new Map<number, { projectUuid: string; secret: string }>()
  readonly calls: string[] = []
  /** Idempotency keys already used; a replay returns no secret, as Opper does. */
  private readonly minted = new Map<string, number>()
  private nextKeyId = 1

  async createProject(name: string): Promise<OpperProject> {
    this.calls.push(`createProject ${name}`)
    await tick()
    const existing = this.projects.get(name)
    if (existing) return existing
    const project = { uuid: `uuid-${name}`, name }
    this.projects.set(name, project)
    return project
  }

  async mintKey(projectUuid: string, name: string, idempotencyKey: string): Promise<MintedKey> {
    this.calls.push(`mintKey ${idempotencyKey}`)
    await tick()
    const replayed = this.minted.get(idempotencyKey)
    if (replayed !== undefined) return { id: replayed, name, key: null }
    const id = this.nextKeyId++
    const secret = `op-secret-${id}`
    this.keys.set(id, { projectUuid, secret })
    this.minted.set(idempotencyKey, id)
    return { id, name, key: secret }
  }

  async deleteKey(_projectUuid: string, id: number): Promise<void> {
    this.calls.push(`deleteKey ${id}`)
    this.keys.delete(id)
  }

  async getMe(runtimeKey: string): Promise<ProjectSpend> {
    this.calls.push('getMe')
    if (![...this.keys.values()].some(key => key.secret === runtimeKey)) {
      throw new Error('unknown runtime key')
    }
    return { spentCents: 12, limitCents: null, blocked: false, blockReason: null }
  }

  /** Usage rows Opper returns, per runtime key secret. */
  readonly usage = new Map<string, UsageRow[]>()
  readonly usageQueries: UsageQuery[] = []

  async getUsage(runtimeKey: string, query: UsageQuery): Promise<UsageRow[]> {
    this.calls.push('getUsage')
    if (![...this.keys.values()].some(key => key.secret === runtimeKey)) {
      throw new Error('unknown runtime key')
    }
    this.usageQueries.push(query)
    return this.usage.get(runtimeKey) ?? []
  }

  /** Simulates a previous run that minted a key and crashed before storing it. */
  preMint(idempotencyKey: string): void {
    this.minted.set(idempotencyKey, this.nextKeyId)
    this.keys.set(this.nextKeyId, { projectUuid: 'lost', secret: 'lost-secret' })
    this.nextKeyId++
  }
}

export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 5))
}

/** A Response whose body arrives in several chunks, like an SSE stream. */
export function chunkedResponse(
  chunks: string[],
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
        await new Promise(resolve => setTimeout(resolve, 1))
      }
      controller.close()
    },
  })
  return new Response(body, { status: init.status ?? 200, headers: init.headers })
}

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
  const claims: Record<string, unknown> = { scope: overrides.scope ?? 'inference' }
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

  async reportUsage(report: UsageReport): Promise<UsageReportResponse> {
    this.reports.push(report)
    return this.respond(report)
  }
}
