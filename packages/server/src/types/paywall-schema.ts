/**
 * Zod schemas for `PaywallStructuredContent`. Declared so MCP hosts can
 * hydrate `structuredContent` and so we fail loud when a required field
 * the narrator claims to print is missing. Every recovery field is
 * optional — a default here would invent data the backend did not send.
 */

import { z } from 'zod'
import { PAYWALL_NEXT_ACTIONS, PAYWALL_REASONS } from './paywall'

const includedSchema = z.object({
  total: z.number(),
  used: z.number(),
  remaining: z.number(),
})

const recoveryFields = {
  planRef: z.string().optional(),
  planName: z.string().optional(),
  plans: z.array(z.record(z.string(), z.unknown())).optional(),
  meterName: z.string().optional(),
  unitPriceMinor: z.number().optional(),
  currency: z.string().optional(),
  included: includedSchema.optional(),
  creditBalance: z.number().optional(),
  balance: z.record(z.string(), z.unknown()).optional(),
  productDetails: z.record(z.string(), z.unknown()).optional(),
  reason: z.enum(PAYWALL_REASONS).optional(),
  nextAction: z.enum(PAYWALL_NEXT_ACTIONS).optional(),
  creditsPerCall: z.number().optional(),
  shortfallCredits: z.number().optional(),
  remainingCalls: z.number().optional(),
  creditsPerMinorUnit: z.number().optional(),
  displayExchangeRate: z.number().optional(),
  purchaseRef: z.string().optional(),
  planStatus: z.string().optional(),
  autoRecharge: z
    .object({
      enabled: z.boolean(),
      status: z.string().optional(),
    })
    .optional(),
  links: z
    .object({
      topup: z.string().optional(),
      checkout: z.string().optional(),
      manage: z.string().optional(),
    })
    .optional(),
}

export const PaywallStructuredContentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('payment_required'),
    product: z.string(),
    checkoutUrl: z.string(),
    message: z.string(),
    ...recoveryFields,
  }),
  z.object({
    kind: z.literal('activation_required'),
    product: z.string(),
    checkoutUrl: z.string(),
    message: z.string(),
    confirmationUrl: z.string().optional(),
    ...recoveryFields,
  }),
])
