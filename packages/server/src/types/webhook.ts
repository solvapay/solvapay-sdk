export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded'
  | 'payment.refund_failed'
  | 'purchase.created'
  | 'purchase.updated'
  | 'purchase.cancelled'
  | 'purchase.expired'
  | 'purchase.suspended'
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'checkout_session.created'

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

export type WebhookEventObjectMap = {
  'payment.succeeded': WebhookPayloadObject
  'payment.failed': WebhookPayloadObject
  'payment.refunded': WebhookPayloadObject
  'payment.refund_failed': WebhookPayloadObject
  'purchase.created': WebhookPayloadObject
  'purchase.updated': WebhookPayloadObject
  'purchase.cancelled': WebhookPayloadObject
  'purchase.expired': WebhookPayloadObject
  'purchase.suspended': WebhookPayloadObject
  'customer.created': CustomerWebhookObject
  'customer.updated': CustomerWebhookObject
  'customer.deleted': CustomerWebhookObject
  'checkout_session.created': WebhookPayloadObject
}

export type WebhookEventForType<TType extends WebhookEventType> = {
  id: string
  type: TType
  created: number
  api_version: string
  data: {
    object: WebhookEventObjectMap[TType]
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
