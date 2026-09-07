/**
 * Zod schema for `BootstrapPayload`. Every field the narrator may omit
 * is optional here — a default would invent data the backend did not
 * send (the no-fallback rule).
 */

import { z } from 'zod'

export const BootstrapPayloadSchema = z
  .object({
    view: z.string(),
    productRef: z.string(),
    stripePublishableKey: z.string().nullable(),
    returnUrl: z.string(),
    merchant: z.record(z.string(), z.unknown()),
    product: z.record(z.string(), z.unknown()),
    plans: z.array(z.record(z.string(), z.unknown())),
    customer: z.record(z.string(), z.unknown()).nullable(),
    checkoutUrl: z.string().nullable().optional(),
    portalUrl: z.string().nullable().optional(),
  })
  .passthrough()
