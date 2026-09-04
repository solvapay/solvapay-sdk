/**
 * Smoke tests for the napi-rs binding (step 36).
 *
 * Accept path signs a fresh body with the frozen Step-4 secret so wall-clock
 * `verifyWebhook` stays inside the ±300 s window. Reject path uses a bad HMAC.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WEBHOOK_SMOKE_BODY,
  WEBHOOK_SMOKE_EVENT_ID,
  WEBHOOK_SMOKE_EVENT_TYPE,
  WEBHOOK_SMOKE_SECRET,
  freshWebhookSmokeSigned,
  signWebhookSmoke,
} from '../scripts/webhook-smoke-fixture.mjs'

/** Frozen Step-4 fixture clock (matches the body's `created`). */
const FIXTURE_CLOCK = 1782864000

describe('@solvapay/server-native binding smoke', () => {
  it('napiVersion returns a non-empty string', async () => {
    const { napiVersion } = await import('../index.js')
    const version = napiVersion()
    assert.equal(typeof version, 'string')
    assert.ok(version.length > 0, 'napiVersion must be non-empty')
  })

  it('verifyWebhook accepts a known-good signed body', async () => {
    const { verifyWebhook } = await import('../index.js')
    const signed = freshWebhookSmokeSigned()
    const json = verifyWebhook(signed.body, signed.signature, signed.secret)
    const value = JSON.parse(json)
    assert.equal(value.type, WEBHOOK_SMOKE_EVENT_TYPE)
    assert.equal(value.id, WEBHOOK_SMOKE_EVENT_ID)
  })

  it('verifyWebhook accepts a frozen fixture body with an injected clock', async () => {
    const { verifyWebhook } = await import('../index.js')
    const signature = signWebhookSmoke(WEBHOOK_SMOKE_BODY, WEBHOOK_SMOKE_SECRET, FIXTURE_CLOCK)
    const json = verifyWebhook(WEBHOOK_SMOKE_BODY, signature, WEBHOOK_SMOKE_SECRET, FIXTURE_CLOCK)
    const value = JSON.parse(json)
    assert.equal(value.id, WEBHOOK_SMOKE_EVENT_ID)
  })

  it('verifyWebhook rejects an out-of-tolerance injected clock', async () => {
    const { verifyWebhook } = await import('../index.js')
    const signature = signWebhookSmoke(WEBHOOK_SMOKE_BODY, WEBHOOK_SMOKE_SECRET, FIXTURE_CLOCK)
    assert.throws(
      () =>
        verifyWebhook(WEBHOOK_SMOKE_BODY, signature, WEBHOOK_SMOKE_SECRET, FIXTURE_CLOCK + 400),
      err => {
        assert.ok(err instanceof Error)
        assert.equal(err.code, 'timestamp_too_old')
        return true
      },
    )
  })

  it('verifyWebhook throws with code on a bad signature', async () => {
    const { verifyWebhook } = await import('../index.js')
    const t = Math.floor(Date.now() / 1000)
    const badSig = `t=${t},v1=${'ff'.repeat(32)}`
    assert.throws(
      () => verifyWebhook(WEBHOOK_SMOKE_BODY, badSig, WEBHOOK_SMOKE_SECRET),
      err => {
        assert.ok(err instanceof Error)
        assert.equal(err.code, 'invalid_signature')
        return true
      },
    )
  })
})
