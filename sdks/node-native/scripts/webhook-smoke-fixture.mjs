/**
 * Shared webhook smoke fixture (Step 4 frozen secret/body + wall-clock HMAC).
 * Used by in-tree binding.spec and clean-install consumer smoke.
 */

import { createHmac } from 'node:crypto'

export const WEBHOOK_SMOKE_SECRET = 'whsec_test_fixture_secret'

export const WEBHOOK_SMOKE_BODY =
  '{"type":"purchase.created","id":"evt_fixture_1","created":1782864000,"api_version":"2025-10-01","data":{"object":{"id":"pur_fixture_1"},"previous_attributes":null},"livemode":false,"request":{"id":null,"idempotency_key":null}}'

export const WEBHOOK_SMOKE_EVENT_TYPE = 'purchase.created'
export const WEBHOOK_SMOKE_EVENT_ID = 'evt_fixture_1'

/**
 * @param {string} body
 * @param {string} secret
 * @param {number} t unix seconds
 * @returns {string}
 */
export function signWebhookSmoke(body, secret, t) {
  const hex = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},v1=${hex}`
}

/**
 * Fresh wall-clock signature for the frozen fixture body.
 * @param {number} [nowSecs]
 * @returns {{ body: string, signature: string, secret: string, t: number }}
 */
export function freshWebhookSmokeSigned(nowSecs = Math.floor(Date.now() / 1000)) {
  return {
    body: WEBHOOK_SMOKE_BODY,
    secret: WEBHOOK_SMOKE_SECRET,
    t: nowSecs,
    signature: signWebhookSmoke(WEBHOOK_SMOKE_BODY, WEBHOOK_SMOKE_SECRET, nowSecs),
  }
}
