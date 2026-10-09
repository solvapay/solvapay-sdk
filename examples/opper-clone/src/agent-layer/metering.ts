// Metering for an agent's paid calls (agent payments PoC, S4): gate each call
// on the customer's balance, then settle it at the cost Opper reported.
//
// Settle rules (build plan §7d, decision 8):
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
  | { kind: 'refused'; reason: 'customer_not_linked' | 'topup_required'; response: Response }

export interface Metering {
  open(input: { request: Request; principalRef: string }): Promise<Opened>
}

export function createMetering(deps: {
  solvaPay: Pick<SolvaPay, 'payable' | 'getCustomer'>
  productRef: string
  /** The most one call is expected to cost, USD decimal string. */
  estimateUsd: string
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
    async open({ request, principalRef }) {
      const customerRef = await customerOf(principalRef)
      if (!customerRef) {
        return {
          kind: 'refused',
          reason: 'customer_not_linked',
          response: Response.json(
            {
              error:
                'This agent has no payment set up with this merchant. Connect it in SolvaPay, then retry.',
              reason: 'customer_not_linked',
            },
            { status: 402 },
          ),
        }
      }

      const gate = await payable.gate(request, {
        cost: { estimateUsd: deps.estimateUsd },
        getCustomerRef: () => customerRef,
      })
      if (gate.kind === 'paywall') {
        return { kind: 'refused', reason: 'topup_required', response: gate.response }
      }

      return {
        kind: 'allow',
        customerRef,
        balanceUsd: gate.balanceUsd,
        async settle(result) {
          if (result.status >= 400) return { settled: false, reason: 'upstream_error' }
          const amountUsd = result.costUsd !== null ? usdString(result.costUsd) : deps.estimateUsd
          const source = result.costUsd !== null ? 'reported' : 'provisional'
          const debit = await gate.settle({
            amountUsd,
            source,
            outcome: result.interrupted ? 'fail' : 'success',
            ...(result.interrupted ? { metadata: { interrupted: result.interrupted } } : {}),
          })
          return { settled: true, source, amountUsd, debit }
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
