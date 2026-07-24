import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { resetWebhookBindingCache, setWebhookBindingForTests } from '../src/webhook-native'
import { verifyWebhook } from '../src/index'

const mockVerifyWebhook = vi.fn()

const fakeBinding = {
  verifyWebhook: (...args: [string, string, string, number?]) =>
    mockVerifyWebhook(...args) as string,
}

const eventBody = JSON.stringify({
  type: 'purchase.created',
  id: 'evt_impl_123',
  created: Math.floor(Date.now() / 1000),
  api_version: '2025-10-01',
  data: {
    object: { id: 'pur_impl_123' },
    previous_attributes: null,
  },
  livemode: false,
  request: { id: null, idempotency_key: null },
})

describe('verifyWebhook native dispatch', () => {
  beforeEach(() => {
    mockVerifyWebhook.mockReset()
    resetWebhookBindingCache()
  })

  afterEach(() => {
    resetWebhookBindingCache()
  })

  it('dispatches to the native binding, injecting the host clock', () => {
    setWebhookBindingForTests(fakeBinding)
    mockVerifyWebhook.mockReturnValue(eventBody)
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_782_864_000_500)

    const event = verifyWebhook({
      body: eventBody,
      signature: 't=1,v1=deadbeef',
      secret: 'whsec_test',
    })

    expect(mockVerifyWebhook).toHaveBeenCalledTimes(1)
    expect(mockVerifyWebhook).toHaveBeenCalledWith(
      eventBody,
      't=1,v1=deadbeef',
      'whsec_test',
      1_782_864_000,
    )
    expect(event.type).toBe('purchase.created')
    nowSpy.mockRestore()
  })

  it('rewraps a native Error as SolvaPayError and preserves its code', () => {
    setWebhookBindingForTests(fakeBinding)
    const message = 'Invalid webhook signature'
    const nativeErr = new Error(message) as Error & { code?: string }
    nativeErr.code = 'invalid_signature'
    mockVerifyWebhook.mockImplementation(() => {
      throw nativeErr
    })

    try {
      verifyWebhook({ body: eventBody, signature: 't=1,v1=deadbeef', secret: 'whsec_test' })
      expect.unreachable('expected verifyWebhook to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(SolvaPayError)
      expect((err as SolvaPayError).message).toBe(message)
      expect((err as SolvaPayError).code).toBe('invalid_signature')
    }
  })

  it('throws when the native binding is missing', () => {
    setWebhookBindingForTests(null)

    expect(() =>
      verifyWebhook({ body: eventBody, signature: 't=1,v1=deadbeef', secret: 'whsec_test' }),
    ).toThrowError(SolvaPayError)
  })
})
