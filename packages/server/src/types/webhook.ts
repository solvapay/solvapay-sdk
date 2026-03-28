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

export interface WebhookEvent {
  id: string
  type: WebhookEventType
  created: number
  api_version: string
  data: {
    object: Record<string, any>
    previous_attributes: Record<string, any> | null
  }
  livemode: boolean
  request: {
    id: string | null
    idempotency_key: string | null
  }
}
