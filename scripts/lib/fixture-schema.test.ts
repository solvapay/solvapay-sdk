import { describe, expect, it } from 'vitest'
import { FixtureSchema, parseFixture } from './fixture-schema.js'

const webhookAccept = {
  suite: 'webhook-verification',
  case: 'accept',
  input: {
    fn: 'verifyWebhook',
    args: {
      body: '{"type":"purchase.created"}',
      signature: 't=1,v1=abc',
      secret: 'whsec_test',
    },
    clock: '2026-07-01T00:00:00Z',
  },
  expect: {
    result: { type: 'purchase.created' },
  },
}

const webhookError = {
  suite: 'webhook-verification',
  case: 'timestamp-too-old',
  input: {
    fn: 'verifyWebhook',
    args: { body: '{}', signature: 't=1,v1=abc', secret: 'whsec_test' },
    clock: '2026-07-01T00:00:00Z',
  },
  expect: {
    error: {
      name: 'SolvaPayError',
      message: 'Webhook signature timestamp too old',
      kind: 'Webhook',
      code: 'timestamp_too_old',
    },
  },
}

const clientWire = {
  suite: 'client',
  case: 'create-payment-intent-success',
  input: {
    fn: 'createPaymentIntent',
    args: {
      productRef: 'prod_fixture',
      planRef: 'plan_basic',
      customerRef: 'cus_fixture',
    },
    clock: '2026-07-01T00:00:00Z',
    rngSeed: 42,
  },
  wire: {
    request: {
      method: 'POST',
      path: '/v1/sdk/payment-intents',
      headers: {
        'Idempotency-Key': 'payment-plan_basic-1782864000000-ln13h9a6y',
      },
      body: {
        productRef: 'prod_fixture',
        planRef: 'plan_basic',
        customerRef: 'cus_fixture',
      },
    },
    response: {
      status: 200,
      body: { id: 'pi_fixture_1' },
    },
  },
  expect: {
    result: { id: 'pi_fixture_1' },
  },
}

describe('FixtureSchema', () => {
  it('accepts a webhook success fixture', () => {
    expect(FixtureSchema.parse(webhookAccept)).toEqual(webhookAccept)
  })

  it('accepts a webhook error fixture with Rust-era kind/code', () => {
    expect(FixtureSchema.parse(webhookError)).toEqual(webhookError)
  })

  it('accepts a client wire fixture with rngSeed', () => {
    expect(FixtureSchema.parse(clientWire)).toEqual(clientWire)
  })

  it('rejects fixtures missing suite or case', () => {
    expect(() => FixtureSchema.parse({ ...webhookAccept, suite: undefined })).toThrow()
    expect(() => FixtureSchema.parse({ ...webhookAccept, case: undefined })).toThrow()
  })

  it('rejects fixtures missing input.fn', () => {
    expect(() =>
      FixtureSchema.parse({
        ...webhookAccept,
        input: { args: {}, clock: '2026-07-01T00:00:00Z' },
      }),
    ).toThrow()
  })

  it('rejects expect with both result and error', () => {
    expect(() =>
      FixtureSchema.parse({
        ...webhookAccept,
        expect: {
          result: { ok: true },
          error: { message: 'nope' },
        },
      }),
    ).toThrow()
  })

  it('rejects expect with neither result nor error', () => {
    expect(() =>
      FixtureSchema.parse({
        ...webhookAccept,
        expect: {},
      }),
    ).toThrow()
  })

  it('rejects wire.request missing method or path', () => {
    expect(() =>
      FixtureSchema.parse({
        ...clientWire,
        wire: {
          request: { path: '/v1/sdk/payment-intents' },
          response: { status: 200, body: {} },
        },
      }),
    ).toThrow()
  })

  it('parseFixture returns the typed fixture', () => {
    const fixture = parseFixture(webhookAccept)
    expect(fixture.suite).toBe('webhook-verification')
    expect(fixture.input.fn).toBe('verifyWebhook')
  })
})
