// Metering for an agent's paid calls (agent payments PoC, S4): gate each call
// on the customer's balance, then settle it at the cost Opper reported. Since
// S5 the spend policy decides first (`./policy`), and the gate takes that
// call's estimate.
//
// Settle rules (build plan §7d, decision 8; the spend policy settles by the same rules):
// - the upstream reported a cost: settle at that cost, also when the stream
//   was cut after the cost was read;
// - the upstream answered without a cost: one provisional settle at the
//   estimate;
// - the upstream answered with an error status: no settle.
// A call is settled once, never both reported and provisional.
import type { CostSettlement, SolvaPay } from '@solvapay/server'

export interface CallResult {
  /** Status Opper answered with. */
  status: number
  /** The cost Opper reported, or null when none arrived. */
  costUsd: number | null
  /** Set when the stream to the caller broke before it finished. */
  interrupted?: string
}

export type Settled =
  | {
      settled: true
      source: 'reported' | 'provisional'
      amountUsd: string
      debit: CostSettlement
    }
  | { settled: false; reason: 'upstream_error' }

export type Opened =
  | {
      kind: 'allow'
      customerRef: string
      /** The balance the call was allowed on, USD decimal string. */
      balanceUsd: string
      settle(result: CallResult): Promise<Settled>
    }
  /** `message` is the gate's own text: the balance and the estimate. */
  | { kind: 'refused'; reason: 'topup_required'; message: string }

export interface Metering {
  /** The customer an agent's principal is at this merchant, or null when it never linked. */
  customer(principalRef: string): Promise<string | null>
  open(input: {
    request: Request
    customerRef: string
    /** This call's estimate, USD decimal string; also the provisional amount. */
    estimateUsd: string
    /** Added to the usage row the settle writes, for example `decision_ref`. */
    metadata?: Record<string, string>
  }): Promise<Opened>
}

/**
 * What a finished call is settled at: the reported cost, else the estimate
 * as provisional; null when the upstream answered with an error.
 */
export function amountToSettle(
  result: CallResult,
  estimateUsd: string,
): { source: 'reported' | 'provisional'; amountUsd: string } | null {
  if (result.status >= 400) return null
  return result.costUsd !== null
    ? { source: 'reported', amountUsd: usdString(result.costUsd) }
    : { source: 'provisional', amountUsd: estimateUsd }
}

export function createMetering(deps: {
  solvaPay: Pick<SolvaPay, 'payable' | 'getCustomer'>
  productRef: string
}): Metering {
  const payable = deps.solvaPay.payable({ productRef: deps.productRef })
  /** principal → customer reference; a principal's customer never changes. */
  const customers = new Map<string, Promise<string | null>>()

  function customerOf(principalRef: string): Promise<string | null> {
    const known = customers.get(principalRef)
    if (known) return known
    const lookup = findCustomer(principalRef)
    customers.set(principalRef, lookup)
    // Only a found customer is kept: an unlinked principal may link later.
    lookup.then(
      ref => ref === null && customers.delete(principalRef),
      () => customers.delete(principalRef),
    )
    return lookup
  }

  /** Lookup only: the customer is created when the consumer links the agent, never here. */
  async function findCustomer(principalRef: string): Promise<string | null> {
    try {
      const customer = await deps.solvaPay.getCustomer({ externalRef: principalRef })
      return customer.customerRef ?? null
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  return {
    customer: customerOf,

    async open({ request, customerRef, estimateUsd, metadata }) {
      const gate = await payable.gate(request, {
        cost: { estimateUsd },
        getCustomerRef: () => customerRef,
      })
      if (gate.kind === 'paywall') {
        return { kind: 'refused', reason: 'topup_required', message: gate.content.message }
      }

      return {
        kind: 'allow',
        customerRef,
        balanceUsd: gate.balanceUsd,
        async settle(result) {
          const amount = amountToSettle(result, estimateUsd)
          if (!amount) return { settled: false, reason: 'upstream_error' }
          const extra = {
            ...(metadata ?? {}),
            ...(result.interrupted ? { interrupted: result.interrupted } : {}),
          }
          const debit = await gate.settle({
            ...amount,
            outcome: result.interrupted ? 'fail' : 'success',
            ...(Object.keys(extra).length > 0 ? { metadata: extra } : {}),
          })
          return { settled: true, ...amount, debit }
        },
      }
    },
  }
}

/** A cost as a USD decimal string with up to 8 places, trailing zeros trimmed. */
export function usdString(usd: number): string {
  const fixed = usd.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
  return fixed === '' ? '0' : fixed
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const status = 'status' in error ? error.status : undefined
  return status === 404 || error.message.startsWith('No customer found')
}
