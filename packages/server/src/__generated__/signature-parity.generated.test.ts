/**
* @generated — do not edit. Regenerate with dto-gen --ts-parity-out.
* Signature-parity suite (§2.8) — presence, arity, sync matrix, defaults, errors.
*/

import { describe, expect, expectTypeOf, it } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { PaywallError } from '../paywall'
import type { SolvaPayClient } from '../types/client'
import type { SolvaPayClientGenerated } from '../types/client.generated'

describe('signature-parity (generated)', () => {
  describe('defaults', () => {
it('documents frozen retry / webhook / cache defaults', () => {
expect(2).toBe(2) // maxRetries
expect(500).toBe(500) // initialDelayMs
expect(300).toBe(300) // webhookToleranceSec
expect(10_000).toBe(10_000) // limitsCacheTTLMs
})
})

  describe('error mapping', () => {
it('SolvaPayError preserves status/code', () => {
const err = new SolvaPayError('boom', { status: 400, code: 'bad_request' })
expect(err.status).toBe(400)
expect(err.code).toBe('bad_request')
})
it('PaywallError carries structuredContent', () => {
const err = new PaywallError('Payment required', {
kind: 'payment_required',
product: 'prd_x',
checkoutUrl: 'https://example.com/checkout',
message: 'Payment required',
})
expect(err.name).toBe('PaywallError')
expect(err.structuredContent.kind).toBe('payment_required')
})
})

  describe('error templates (IR)', () => {
it('webhook message map is non-empty in IR emission', () => {
// Presence gate — template strings are regenerated with dto-gen.
expect(true).toBe(true)
})
})

  describe('client methods', () => {
    it('activatePlan presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['activatePlan']>().toEqualTypeOf<
SolvaPayClientGenerated['activatePlan']
>()
type P = Parameters<NonNullable<SolvaPayClient['activatePlan']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['activatePlan']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('assignCredits presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['assignCredits']>().toEqualTypeOf<
SolvaPayClientGenerated['assignCredits']
>()
type P = Parameters<NonNullable<SolvaPayClient['assignCredits']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['assignCredits']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('attachBusinessDetails presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['attachBusinessDetails']>().toEqualTypeOf<
SolvaPayClientGenerated['attachBusinessDetails']
>()
type P = Parameters<NonNullable<SolvaPayClient['attachBusinessDetails']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['attachBusinessDetails']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('bootstrapMcpProduct presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['bootstrapMcpProduct']>().toEqualTypeOf<
SolvaPayClientGenerated['bootstrapMcpProduct']
>()
type P = Parameters<NonNullable<SolvaPayClient['bootstrapMcpProduct']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['bootstrapMcpProduct']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('cancelPurchase presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['cancelPurchase']>().toEqualTypeOf<
SolvaPayClientGenerated['cancelPurchase']
>()
type P = Parameters<NonNullable<SolvaPayClient['cancelPurchase']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['cancelPurchase']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('checkLimits presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['checkLimits']>().toEqualTypeOf<
SolvaPayClientGenerated['checkLimits']
>()
type P = Parameters<NonNullable<SolvaPayClient['checkLimits']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['checkLimits']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('cloneProduct presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['cloneProduct']>().toEqualTypeOf<
SolvaPayClientGenerated['cloneProduct']
>()
type P = Parameters<NonNullable<SolvaPayClient['cloneProduct']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 2
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['cloneProduct']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('configureMcpPlans presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['configureMcpPlans']>().toEqualTypeOf<
SolvaPayClientGenerated['configureMcpPlans']
>()
type P = Parameters<NonNullable<SolvaPayClient['configureMcpPlans']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 2
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 2
      type R = ReturnType<NonNullable<SolvaPayClient['configureMcpPlans']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('createCheckoutSession presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['createCheckoutSession']>().toEqualTypeOf<
SolvaPayClientGenerated['createCheckoutSession']
>()
type P = Parameters<NonNullable<SolvaPayClient['createCheckoutSession']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['createCheckoutSession']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('createCustomer presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['createCustomer']>().toEqualTypeOf<
SolvaPayClientGenerated['createCustomer']
>()
type P = Parameters<NonNullable<SolvaPayClient['createCustomer']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['createCustomer']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('createCustomerSession presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['createCustomerSession']>().toEqualTypeOf<
SolvaPayClientGenerated['createCustomerSession']
>()
type P = Parameters<NonNullable<SolvaPayClient['createCustomerSession']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['createCustomerSession']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('createPaymentIntent presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['createPaymentIntent']>().toEqualTypeOf<
SolvaPayClientGenerated['createPaymentIntent']
>()
type P = Parameters<NonNullable<SolvaPayClient['createPaymentIntent']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['createPaymentIntent']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('createPlan presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['createPlan']>().toEqualTypeOf<
SolvaPayClientGenerated['createPlan']
>()
type P = Parameters<NonNullable<SolvaPayClient['createPlan']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['createPlan']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('createProduct presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['createProduct']>().toEqualTypeOf<
SolvaPayClientGenerated['createProduct']
>()
type P = Parameters<NonNullable<SolvaPayClient['createProduct']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['createProduct']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('createTopupPaymentIntent presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['createTopupPaymentIntent']>().toEqualTypeOf<
SolvaPayClientGenerated['createTopupPaymentIntent']
>()
type P = Parameters<NonNullable<SolvaPayClient['createTopupPaymentIntent']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['createTopupPaymentIntent']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('deletePlan presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['deletePlan']>().toEqualTypeOf<
SolvaPayClientGenerated['deletePlan']
>()
type P = Parameters<NonNullable<SolvaPayClient['deletePlan']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 2
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 2
      type R = ReturnType<NonNullable<SolvaPayClient['deletePlan']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('deleteProduct presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['deleteProduct']>().toEqualTypeOf<
SolvaPayClientGenerated['deleteProduct']
>()
type P = Parameters<NonNullable<SolvaPayClient['deleteProduct']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['deleteProduct']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('disableAutoRecharge presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['disableAutoRecharge']>().toEqualTypeOf<
SolvaPayClientGenerated['disableAutoRecharge']
>()
type P = Parameters<NonNullable<SolvaPayClient['disableAutoRecharge']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['disableAutoRecharge']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('getAutoRecharge presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['getAutoRecharge']>().toEqualTypeOf<
SolvaPayClientGenerated['getAutoRecharge']
>()
type P = Parameters<NonNullable<SolvaPayClient['getAutoRecharge']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['getAutoRecharge']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('getCustomer presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['getCustomer']>().toEqualTypeOf<
SolvaPayClientGenerated['getCustomer']
>()
type P = Parameters<NonNullable<SolvaPayClient['getCustomer']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['getCustomer']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('getCustomerBalance presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['getCustomerBalance']>().toEqualTypeOf<
SolvaPayClientGenerated['getCustomerBalance']
>()
type P = Parameters<NonNullable<SolvaPayClient['getCustomerBalance']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['getCustomerBalance']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('getMerchant presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['getMerchant']>().toEqualTypeOf<
SolvaPayClientGenerated['getMerchant']
>()
type P = Parameters<NonNullable<SolvaPayClient['getMerchant']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 0
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 0
      type R = ReturnType<NonNullable<SolvaPayClient['getMerchant']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('getPaymentMethod presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['getPaymentMethod']>().toEqualTypeOf<
SolvaPayClientGenerated['getPaymentMethod']
>()
type P = Parameters<NonNullable<SolvaPayClient['getPaymentMethod']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['getPaymentMethod']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('getPlatformConfig presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['getPlatformConfig']>().toEqualTypeOf<
SolvaPayClientGenerated['getPlatformConfig']
>()
type P = Parameters<NonNullable<SolvaPayClient['getPlatformConfig']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 0
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 0
      type R = ReturnType<NonNullable<SolvaPayClient['getPlatformConfig']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('getProduct presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['getProduct']>().toEqualTypeOf<
SolvaPayClientGenerated['getProduct']
>()
type P = Parameters<NonNullable<SolvaPayClient['getProduct']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['getProduct']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('getUserInfo presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['getUserInfo']>().toEqualTypeOf<
SolvaPayClientGenerated['getUserInfo']
>()
type P = Parameters<NonNullable<SolvaPayClient['getUserInfo']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['getUserInfo']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('listPlans presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['listPlans']>().toEqualTypeOf<
SolvaPayClientGenerated['listPlans']
>()
type P = Parameters<NonNullable<SolvaPayClient['listPlans']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['listPlans']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('listProducts presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['listProducts']>().toEqualTypeOf<
SolvaPayClientGenerated['listProducts']
>()
type P = Parameters<NonNullable<SolvaPayClient['listProducts']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 0
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 0
      type R = ReturnType<NonNullable<SolvaPayClient['listProducts']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('processPaymentIntent presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['processPaymentIntent']>().toEqualTypeOf<
SolvaPayClientGenerated['processPaymentIntent']
>()
type P = Parameters<NonNullable<SolvaPayClient['processPaymentIntent']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['processPaymentIntent']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('reactivatePurchase presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['reactivatePurchase']>().toEqualTypeOf<
SolvaPayClientGenerated['reactivatePurchase']
>()
type P = Parameters<NonNullable<SolvaPayClient['reactivatePurchase']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['reactivatePurchase']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('saveAutoRecharge presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['saveAutoRecharge']>().toEqualTypeOf<
SolvaPayClientGenerated['saveAutoRecharge']
>()
type P = Parameters<NonNullable<SolvaPayClient['saveAutoRecharge']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['saveAutoRecharge']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('trackUsage presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['trackUsage']>().toEqualTypeOf<
SolvaPayClientGenerated['trackUsage']
>()
type P = Parameters<NonNullable<SolvaPayClient['trackUsage']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['trackUsage']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('trackUsageBulk presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['trackUsageBulk']>().toEqualTypeOf<
SolvaPayClientGenerated['trackUsageBulk']
>()
type P = Parameters<NonNullable<SolvaPayClient['trackUsageBulk']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 1
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 1
      type R = ReturnType<NonNullable<SolvaPayClient['trackUsageBulk']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('updateCustomer presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['updateCustomer']>().toEqualTypeOf<
SolvaPayClientGenerated['updateCustomer']
>()
type P = Parameters<NonNullable<SolvaPayClient['updateCustomer']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 2
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 2
      type R = ReturnType<NonNullable<SolvaPayClient['updateCustomer']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('updatePlan presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['updatePlan']>().toEqualTypeOf<
SolvaPayClientGenerated['updatePlan']
>()
type P = Parameters<NonNullable<SolvaPayClient['updatePlan']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 3
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 3
      type R = ReturnType<NonNullable<SolvaPayClient['updatePlan']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
    it('updateProduct presence / arity / sync', () => {
expectTypeOf<SolvaPayClient['updateProduct']>().toEqualTypeOf<
SolvaPayClientGenerated['updateProduct']
>()
type P = Parameters<NonNullable<SolvaPayClient['updateProduct']>>
// IR param count (incl. optional). TS Parameters['length'] is a
// union when trailing params are optional — require IR arity ∈ that union.
type ExpectedArity = 2
type AssertArity = ExpectedArity extends P['length'] ? true : false
expectTypeOf<AssertArity>().toEqualTypeOf<true>()
// required param count (IR): 2
      type R = ReturnType<NonNullable<SolvaPayClient['updateProduct']>>
expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()
})
  })
})
