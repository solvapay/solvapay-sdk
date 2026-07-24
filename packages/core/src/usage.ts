/**
 * Usage helper types (Step 52). Helpers are Rust-only in `native-helpers.ts`.
 */

export type UsageSnapshot = {
  meterRef: string | null
  total: number | null
  used: number
  remaining: number | null
  percentUsed: number | null
  periodStart?: string
  periodEnd?: string
  purchaseRef?: string
}

export type UsageSnapshotPurchase = {
  reference?: string
  planSnapshot?: {
    meterRef?: string
    meterId?: string
    limit?: number
  } | null
  usage?: {
    used?: number
    periodStart?: string
    periodEnd?: string
  } | null
}
