/**
 * Deterministic SolvaPayClient mock driven by a fixture's `limits` block.
 */

import type { SolvaPayClient } from '@solvapay/server'

export type TrackUsageCall = Record<string, unknown>

export interface MockBackend {
  client: SolvaPayClient
  trackUsageCalls: TrackUsageCall[]
}

function backendRef(identity: string): string {
  return identity.startsWith('cus_') ? identity : `cus_${identity}`
}

export function createMockBackend(limits: Record<string, unknown>): MockBackend {
  const trackUsageCalls: TrackUsageCall[] = []

  const client = {
    checkLimits: async () => limits,
    trackUsage: async (params: Record<string, unknown>) => {
      trackUsageCalls.push(params)
    },
    createCustomer: async (params: { email?: string; externalRef?: string }) => ({
      customerRef: backendRef(params.externalRef ?? params.email ?? 'new'),
    }),
    getCustomer: async (params: { customerRef?: string; externalRef?: string; email?: string }) => {
      const ref = params.customerRef ?? params.externalRef ?? params.email ?? 'new'
      return { customerRef: backendRef(ref) }
    },
  } as unknown as SolvaPayClient

  return { client, trackUsageCalls }
}

export function projectUsage(calls: TrackUsageCall[]): Array<{
  outcome: unknown
  actionType: unknown
  units: unknown
  productRef: unknown
  customerRef: unknown
  metadata: { action: unknown }
}> {
  return calls.map(call => {
    const metadata =
      typeof call.metadata === 'object' && call.metadata !== null
        ? (call.metadata as Record<string, unknown>)
        : {}
    if (!('duration' in call)) {
      throw new Error('trackUsage call missing duration')
    }
    if (!('timestamp' in call)) {
      throw new Error('trackUsage call missing timestamp')
    }
    if (!('requestId' in metadata)) {
      throw new Error('trackUsage call missing metadata.requestId')
    }
    return {
      outcome: call.outcome,
      actionType: call.actionType,
      units: call.units,
      productRef: call.productRef,
      customerRef: call.customerRef,
      metadata: { action: metadata.action },
    }
  })
}
