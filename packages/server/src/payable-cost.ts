/**
 * Cost mode for `payable.gate()`: for a merchant whose price is known only
 * after the call (an LLM API billed per token), the call is settled at the
 * cost it reports, and the customer's credits are debited by exactly that
 * amount. No plan is involved and `/limits` is never called.
 *
 * The gate allows a call while the customer's balance covers an estimate of
 * one call's cost. The balance is read once per customer and then taken from
 * each settle's response, so a busy customer costs no extra balance reads.
 * Calls in flight are not reserved against the balance: with N calls in
 * flight, the balance can go below zero by at most N estimates.
 *
 * Amounts are USD decimal strings with up to 8 places, so a sub-cent cost
 * never passes through a float. Internally they are integers of 1e-8 USD.
 */

import { SolvaPayError } from '@solvapay/core'
import { PaywallError, paywallErrorToClientPayload } from './paywall'
import type {
  CostDebitResult,
  PaywallStructuredContent,
  SolvaPayClient,
  TrackUsageResponse,
} from './types'

/** @since 2.11.0 */
export interface PayableCostOptions {
  /**
   * The most one call is expected to cost, as a USD decimal string with up
   * to 8 places (for example `"0.50"`). A call is allowed while the balance
   * is at least this amount.
   */
  estimateUsd: string
}

/** @since 2.11.0 */
export interface CostSettleInput {
  /** The call's cost, a USD decimal string with up to 8 places. */
  amountUsd: string
  /** `reported` when the upstream reported the cost; `provisional` when it never arrived and the estimate stands in. */
  source: 'reported' | 'provisional'
  /** Defaults to `success`. A failed call that still cost money is settled with `fail`. */
  outcome?: 'success' | 'fail'
  duration?: number
  metadata?: Record<string, unknown>
}

/**
 * The debit a settle produced. `cost_not_supported` means the server
 * accepted the usage event but did not debit by cost (an older server).
 *
 * @since 2.11.0
 */
export type CostSettlement = CostDebitResult | { debited: false; reason: 'cost_not_supported' }

/**
 * Result of `payable.gate(req, { cost })` when the call is allowed.
 *
 * @since 2.11.0
 */
export interface PayableCostAllowResult {
  kind: 'allow'
  customerRef: string
  /** Id of this call; the settle's idempotency key is `${requestId}:cost`. */
  requestId: string
  /** The balance the call was allowed on, USD decimal string. */
  balanceUsd: string
  /**
   * Debit the call's cost. Call it once per allowed call. Settles for one
   * customer are sent one at a time, so each sees the previous one's balance.
   */
  settle(input: CostSettleInput): Promise<CostSettlement>
}

/** 1e-8 USD per unit: the scale of a USD decimal string with 8 places. */
const USD_SCALE = 100_000_000n
const USD_DECIMAL = /^\d+(\.\d{1,8})?$/

export function parseUsd(value: string, field: string): bigint {
  const trimmed = value.trim()
  if (!USD_DECIMAL.test(trimmed)) {
    throw new SolvaPayError(
      `${field} must be a non-negative USD amount with up to 8 decimal places, got "${value}"`,
      { code: 'invalid_cost' },
    )
  }
  const [whole, fraction = ''] = trimmed.split('.')
  return BigInt(whole) * USD_SCALE + BigInt(fraction.padEnd(8, '0'))
}

export function formatUsd(amount: bigint): string {
  const sign = amount < 0n ? '-' : ''
  const abs = amount < 0n ? -amount : amount
  const whole = abs / USD_SCALE
  const fraction = (abs % USD_SCALE).toString().padStart(8, '0').replace(/0+$/, '')
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`
}

const COST_SKIP_REASONS: readonly string[] = [
  'duplicate',
  'customer_not_found',
  'record_failed',
] satisfies Extract<CostDebitResult, { debited: false }>['reason'][]

/** A server that ignores `cost` answers with a unit debit or a unit skip reason. */
function isCostDebit(debit: TrackUsageResponse['creditDebit']): debit is CostDebitResult {
  if (!debit) return false
  return debit.debited ? 'costSource' in debit : COST_SKIP_REASONS.includes(debit.reason)
}

export interface CostMeter {
  gate(input: {
    customerRef: string
    cost: PayableCostOptions
    ctx?: { waitUntil(p: Promise<unknown>): void }
  }): Promise<
    | PayableCostAllowResult
    | { kind: 'paywall'; response: Response; content: PaywallStructuredContent }
  >
}

export function createCostMeter(deps: {
  apiClient: SolvaPayClient
  productRef: string
  meterName: string
  toolName?: string
}): CostMeter {
  const { apiClient, productRef } = deps
  /** Last known exact balance per customer, in 1e-8 USD. */
  const balances = new Map<string, Promise<bigint>>()
  /** Tail of each customer's settle queue. */
  const queues = new Map<string, Promise<unknown>>()

  function balanceOf(customerRef: string): Promise<bigint> {
    const known = balances.get(customerRef)
    if (known) return known
    const read = readBalance(customerRef)
    balances.set(customerRef, read)
    read.catch(() => balances.delete(customerRef))
    return read
  }

  async function readBalance(customerRef: string): Promise<bigint> {
    if (!apiClient.getCustomerBalance) {
      throw new SolvaPayError('getCustomerBalance is not available on this API client')
    }
    const { credits, creditsPerMinorUnit } = await apiClient.getCustomerBalance({ customerRef })
    // credits / creditsPerMinorUnit is US cents; one cent is 1e6 units of 1e-8 USD.
    return (BigInt(credits) * 1_000_000n) / BigInt(creditsPerMinorUnit)
  }

  function enqueue<T>(customerRef: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(customerRef) ?? Promise.resolve()
    const run = previous.then(task, task)
    const tail = run.catch(() => undefined)
    queues.set(customerRef, tail)
    void tail.then(() => {
      if (queues.get(customerRef) === tail) queues.delete(customerRef)
    })
    return run
  }

  async function sendCost(
    customerRef: string,
    requestId: string,
    input: CostSettleInput,
  ): Promise<CostSettlement> {
    let response: TrackUsageResponse
    try {
      response = await apiClient.trackUsage({
        customerRef,
        productRef,
        actionType: 'api_call',
        units: 1,
        outcome: input.outcome ?? 'success',
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        idempotencyKey: `${requestId}:cost`,
        cost: { amount: input.amountUsd.trim(), currency: 'USD', source: input.source },
        metadata: {
          action: deps.meterName,
          requestId,
          ...(deps.toolName ? { toolName: deps.toolName } : {}),
          ...(input.metadata ?? {}),
        },
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      // The debit may or may not have landed; read the balance afresh next time.
      balances.delete(customerRef)
      throw error
    }
    const debit = response.creditDebit
    if (!isCostDebit(debit)) return { debited: false, reason: 'cost_not_supported' }
    if (debit.debited) {
      balances.set(customerRef, Promise.resolve(parseUsd(debit.balanceUsd, 'balanceUsd')))
    }
    return debit
  }

  return {
    async gate({ customerRef, cost, ctx }) {
      if (!customerRef.startsWith('cus_')) {
        throw new SolvaPayError(
          `Cost mode needs a SolvaPay customer reference (cus_…), got "${customerRef}"`,
          { code: 'customer_ref_required' },
        )
      }
      const estimate = parseUsd(cost.estimateUsd, 'estimateUsd')
      const balance = await balanceOf(customerRef)

      if (balance < estimate) {
        const content: PaywallStructuredContent = {
          kind: 'payment_required',
          product: productRef,
          checkoutUrl: '',
          message: `The balance of ${formatUsd(balance)} USD is below the ${formatUsd(estimate)} USD one call may cost. Top up to continue.`,
          reason: 'topup_required',
          nextAction: 'topup',
          currency: 'USD',
        }
        const body = paywallErrorToClientPayload(new PaywallError('Payment required', content))
        const response = new Response(JSON.stringify(body), {
          status: 402,
          headers: { 'content-type': 'application/json' },
        })
        return { kind: 'paywall', response, content }
      }

      const requestId = `solvapay_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
      let settled = false
      return {
        kind: 'allow',
        customerRef,
        requestId,
        balanceUsd: formatUsd(balance),
        settle(input) {
          if (settled) {
            return Promise.reject(new SolvaPayError(`Call ${requestId} is already settled`))
          }
          try {
            parseUsd(input.amountUsd, 'amountUsd')
          } catch (error) {
            return Promise.reject(error)
          }
          settled = true
          const run = enqueue(customerRef, () => sendCost(customerRef, requestId, input))
          ctx?.waitUntil(run.catch(() => undefined))
          return run
        },
      }
    },
  }
}
