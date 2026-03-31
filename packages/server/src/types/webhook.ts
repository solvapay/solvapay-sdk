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

export type WebhookEventObjectMap = {
  'payment.succeeded': Record<string, any>
  'payment.failed': Record<string, any>
  'payment.refunded': Record<string, any>
  'payment.refund_failed': Record<string, any>
  'purchase.created': Record<string, any>
  'purchase.updated': Record<string, any>
  'purchase.cancelled': Record<string, any>
  'purchase.expired': Record<string, any>
  'purchase.suspended': Record<string, any>
  'customer.created': CustomerWebhookObject
  'customer.updated': CustomerWebhookObject
  'customer.deleted': CustomerWebhookObject
  'checkout_session.created': Record<string, any>
}

export type WebhookEventForType<TType extends WebhookEventType> = {
  id: string
  type: TType
  created: number
  api_version: string
  data: {
    object: WebhookEventObjectMap[TType]
    previous_attributes: Record<string, any> | null
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
