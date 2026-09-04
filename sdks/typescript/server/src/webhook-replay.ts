import { SolvaPayError } from '@solvapay/core'
import type { WebhookEvent } from './types/webhook'

/** Thrown / returned when `seenEventId` reports that `event.id` was already processed. */
export const WEBHOOK_DUPLICATE_EVENT_CODE = 'duplicate_event'

export type SeenEventIdSync = (eventId: string) => boolean
export type SeenEventId = (eventId: string) => boolean | Promise<boolean>

export type VerifyWebhookParams = {
  body: string
  signature: string
  secret: string
}

export type VerifyWebhookOptions = VerifyWebhookParams & {
  /**
   * Host-owned replay check. Return `true` when this `event.id` has already
   * been processed. Core verification stays stateless (Stripe-style); this
   * hook is how a facade asks the integrator's store.
   */
  seenEventId?: SeenEventIdSync
}

export type VerifyWebhookEdgeOptions = VerifyWebhookParams & {
  seenEventId?: SeenEventId
}

const eventIdFromVerified = (event: WebhookEvent): string => {
  const id = event.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new SolvaPayError('Webhook event is missing id; cannot apply replay dedupe', {
      code: 'invalid_payload',
    })
  }
  return id
}

const duplicateEventError = (): SolvaPayError =>
  new SolvaPayError('Webhook event already processed', {
    code: WEBHOOK_DUPLICATE_EVENT_CODE,
    status: 200,
  })

export const isDuplicateWebhookEvent = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === WEBHOOK_DUPLICATE_EVENT_CODE

export const rejectIfSeenEventIdSync = (
  event: WebhookEvent,
  seenEventId: SeenEventIdSync | undefined,
): void => {
  if (seenEventId === undefined) {
    return
  }
  if (seenEventId(eventIdFromVerified(event))) {
    throw duplicateEventError()
  }
}

export const rejectIfSeenEventId = async (
  event: WebhookEvent,
  seenEventId: SeenEventId | undefined,
): Promise<void> => {
  if (seenEventId === undefined) {
    return
  }
  if (await seenEventId(eventIdFromVerified(event))) {
    throw duplicateEventError()
  }
}
