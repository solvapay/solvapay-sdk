/**
 * Structural types for composable `options[]` pricing.
 *
 * The readers themselves are Rust-backed (`charges`, `headlineCharges`, …).
 * These aliases exist so plan-shaped payloads can be passed without a
 * generated DTO for every unknown option kind.
 */

import type { BillingCycle, Charge } from './types/boundary.generated'

/** One entry of a plan's `options[]`. Narrowed by the readers. */
export type PricingOptionLike = Record<string, unknown>

/** Anything carrying composable pricing — a catalog plan or a frozen snapshot. */
export interface PricedLike {
  options?: readonly PricingOptionLike[] | null
}

/** Charge option as returned by the Rust readers. */
export type ChargeLike = Charge

/** Billing-cycle option as returned by the Rust readers. */
export type BillingCycleLike = BillingCycle

/** FX-bearing fields of a customer balance, as shipped on bootstrap. */
export interface BalancePegLike {
  displayCurrency?: string | null
  displayExchangeRate?: number | null
  creditsPerMinorUnit?: number | null
}
