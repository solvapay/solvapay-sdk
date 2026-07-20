/**
 * Smoke tests for the napi-rs binding (step 36).
 *
 * Accept path signs a fresh body with the frozen Step-4 secret so wall-clock
 * `verifyWebhook` stays inside the ±300 s window. Reject path uses a bad HMAC.
 */

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'

const SECRET = 'whsec_test_fixture_secret'
const BODY =
  '{"type":"purchase.created","id":"evt_fixture_1","created":1782864000,"api_version":"2025-10-01","data":{"object":{"id":"pur_fixture_1"},"previous_attributes":null},"livemode":false,"request":{"id":null,"idempotency_key":null}}'

function sign(body, secret, t) {
  const hex = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},v1=${hex}`
}

describe('@solvapay/server-native binding smoke', () => {
  it('napiVersion returns a non-empty string', async () => {
    const { napiVersion } = await import('../index.js')
    const version = napiVersion()
    assert.equal(typeof version, 'string')
    assert.ok(version.length > 0, 'napiVersion must be non-empty')
  })

  it('verifyWebhook accepts a known-good signed body', async () => {
    const { verifyWebhook } = await import('../index.js')
    const t = Math.floor(Date.now() / 1000)
    const json = verifyWebhook(BODY, sign(BODY, SECRET, t), SECRET)
    const value = JSON.parse(json)
    assert.equal(value.type, 'purchase.created')
    assert.equal(value.id, 'evt_fixture_1')
  })

  it('verifyWebhook throws with code on a bad signature', async () => {
    const { verifyWebhook } = await import('../index.js')
    const t = Math.floor(Date.now() / 1000)
    const badSig = `t=${t},v1=${'ff'.repeat(32)}`
    assert.throws(
      () => verifyWebhook(BODY, badSig, SECRET),
      err => {
        assert.ok(err instanceof Error)
        assert.equal(err.code, 'invalid_signature')
        return true
      },
    )
  })
})
