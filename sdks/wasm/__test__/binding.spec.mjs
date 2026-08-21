import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ready, verifyWebhook, wasmVersion } from '../runtime/node.js'

const FIXTURE_BODY = JSON.stringify({
  type: 'purchase.created',
  id: 'evt_fixture_1',
  created: 1782864000,
  api_version: '2025-10-01',
  data: { object: { id: 'pur_fixture_1' }, previous_attributes: null },
  livemode: false,
  request: { id: null, idempotency_key: null },
})
const FIXTURE_SECRET = 'whsec_test_fixture_secret'
const FIXTURE_SIGNATURE =
  't=1782864000,v1=04834cba2241fe998a4fb5b8bb4632b2c2e18a3e330dba1905f62b365521ca82'
const FIXTURE_NOW = 1_782_864_000

describe('@solvapay/server-wasm node wrapper', () => {
  it('initializes once and verifies the frozen fixture', async () => {
    await ready()
    assert.equal(typeof wasmVersion(), 'string')
    assert.match(wasmVersion(), /^\d+\.\d+\.\d+/)

    const json = verifyWebhook(
      FIXTURE_BODY,
      FIXTURE_SIGNATURE,
      FIXTURE_SECRET,
      FIXTURE_NOW,
    )
    const event = JSON.parse(json)
    assert.equal(event.type, 'purchase.created')
    assert.equal(event.id, 'evt_fixture_1')

    // Second call reuses the initialized module (no second init).
    const json2 = verifyWebhook(
      FIXTURE_BODY,
      FIXTURE_SIGNATURE,
      FIXTURE_SECRET,
      FIXTURE_NOW,
    )
    assert.equal(JSON.parse(json2).id, 'evt_fixture_1')
  })

  it('rejects invalid signatures with stable code', async () => {
    await ready()
    const bad =
      't=1782864000,v1=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    try {
      verifyWebhook(FIXTURE_BODY, bad, FIXTURE_SECRET, FIXTURE_NOW)
      assert.fail('expected throw')
    } catch (err) {
      assert.equal(err instanceof Error, true)
      assert.equal(err.message, 'Invalid webhook signature')
      assert.equal(err.code, 'invalid_signature')
    }
  })
})
