import type { components } from './generated'

/**
 * The set of webhook event types, generated from the backend OpenAPI spec
 * (`components.schemas.WebhookEventType`). New events flow in automatically
 * whenever the SDK types are regenerated — do not hand-edit this union.
 */
export type WebhookEventType = components['schemas']['WebhookEventType']

export interface WebhookProduct {
  reference: string
}

export interface CustomerWebhookObject {
  id: string
  created: number
  product: WebhookProduct | null
  reference?: string
  name?: string
  email?: string
  telephone?: string
  status?: string
}

type WebhookPayloadObject = Record<string, unknown>

/**
 * Richly-typed payloads for the events whose `data.object` shape is known and
 * stable. Any event type not listed here falls back to a generic object, so the
 * map never needs to be kept exhaustive against {@link WebhookEventType}.
 */
export type WebhookEventObjectMap = {
  'customer.created': CustomerWebhookObject
  'customer.updated': CustomerWebhookObject
  'customer.deleted': CustomerWebhookObject
}

type WebhookObjectForType<TType extends WebhookEventType> =
  TType extends keyof WebhookEventObjectMap ? WebhookEventObjectMap[TType] : WebhookPayloadObject

export type WebhookEventForType<TType extends WebhookEventType> = {
  id: string
  type: TType
  created: number
  api_version: string
  data: {
    object: WebhookObjectForType<TType>
    previous_attributes: Record<string, unknown> | null
  }
  livemode: boolean
  request: {
    id: string | null
    idempotency_key: string | null
  }
}

export type WebhookEvent = {
  [TType in WebhookEventType]: WebhookEventForType<TType>
}[WebhookEventType]
