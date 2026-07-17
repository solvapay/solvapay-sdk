import { describe, it, expect } from 'vitest'
import {
  attachBusinessDetailsValidationError,
  projectPaymentIntentResult,
  projectTopupProcessOutcome,
  validateAttachBusinessDetailsParams,
  validateCreatePaymentIntentParams,
  validateProcessPaymentIntentParams,
  validateTopupPaymentIntentParams,
} from './payment'

describe('validateCreatePaymentIntentParams', () => {
  it('returns null when both refs are present', () => {
    expect(validateCreatePaymentIntentParams('pln_1', 'prd_1')).toBeNull()
  })

  it('rejects missing planRef', () => {
    expect(validateCreatePaymentIntentParams('', 'prd_1')).toEqual({
      error: 'Missing required parameters: planRef and productRef are required',
      status: 400,
    })
  })

  it('rejects missing productRef', () => {
    expect(validateCreatePaymentIntentParams('pln_1', '')).toEqual({
      error: 'Missing required parameters: planRef and productRef are required',
      status: 400,
    })
  })

  it('rejects nullish refs', () => {
    expect(validateCreatePaymentIntentParams(null, 'prd_1')).toEqual({
      error: 'Missing required parameters: planRef and productRef are required',
      status: 400,
    })
    expect(validateCreatePaymentIntentParams('pln_1', undefined)).toEqual({
      error: 'Missing required parameters: planRef and productRef are required',
      status: 400,
    })
  })
})

describe('validateTopupPaymentIntentParams', () => {
  it('returns null for a positive amount and uppercase currency', () => {
    expect(validateTopupPaymentIntentParams(1000, 'USD')).toBeNull()
  })

  it('rejects amount 0', () => {
    expect(validateTopupPaymentIntentParams(0, 'USD')).toEqual({
      error: 'Missing or invalid amount: must be a positive number',
      status: 400,
    })
  })

  it('rejects negative amount', () => {
    expect(validateTopupPaymentIntentParams(-5, 'USD')).toEqual({
      error: 'Missing or invalid amount: must be a positive number',
      status: 400,
    })
  })

  it('rejects NaN amount via JS falsiness', () => {
    expect(validateTopupPaymentIntentParams(Number.NaN, 'USD')).toEqual({
      error: 'Missing or invalid amount: must be a positive number',
      status: 400,
    })
  })

  it('rejects missing currency before case check', () => {
    expect(validateTopupPaymentIntentParams(1000, '')).toEqual({
      error: 'Missing required parameter: currency',
      status: 400,
    })
  })

  it('rejects lowercase currency with byte-exact message', () => {
    expect(validateTopupPaymentIntentParams(1000, 'usd')).toEqual({
      error: 'Invalid currency "usd": must be an uppercase ISO 4217 code (e.g. "USD", "EUR")',
      status: 400,
    })
  })

  it('rejects mixed-case currency with byte-exact message', () => {
    expect(validateTopupPaymentIntentParams(1000, 'Usd')).toEqual({
      error: 'Invalid currency "Usd": must be an uppercase ISO 4217 code (e.g. "USD", "EUR")',
      status: 400,
    })
  })
})

describe('validateProcessPaymentIntentParams', () => {
  it('returns null when both are present', () => {
    expect(validateProcessPaymentIntentParams('pi_1', 'prd_1')).toBeNull()
  })

  it('rejects empty paymentIntentId', () => {
    expect(validateProcessPaymentIntentParams('', 'prd_1')).toEqual({
      error: 'paymentIntentId and productRef are required',
      status: 400,
    })
  })

  it('rejects empty productRef', () => {
    expect(validateProcessPaymentIntentParams('pi_1', '')).toEqual({
      error: 'paymentIntentId and productRef are required',
      status: 400,
    })
  })
})

describe('validateAttachBusinessDetailsParams', () => {
  it('returns null when paymentIntentId is present', () => {
    expect(validateAttachBusinessDetailsParams('pi_1')).toBeNull()
  })

  it('rejects empty paymentIntentId', () => {
    expect(validateAttachBusinessDetailsParams('')).toEqual({
      error: 'paymentIntentId is required',
      status: 400,
    })
  })

  it('rejects nullish paymentIntentId', () => {
    expect(validateAttachBusinessDetailsParams(null)).toEqual({
      error: 'paymentIntentId is required',
      status: 400,
    })
  })
})

describe('attachBusinessDetailsValidationError', () => {
  it('uses the first issue message when present', () => {
    expect(attachBusinessDetailsValidationError('Business name is required')).toEqual({
      error: 'Business name is required',
      status: 400,
    })
  })

  it('falls back to Invalid business details when message is absent', () => {
    expect(attachBusinessDetailsValidationError(undefined)).toEqual({
      error: 'Invalid business details',
      status: 400,
    })
  })
})

describe('projectPaymentIntentResult', () => {
  it('projects the five fields including accountId when present', () => {
    expect(
      projectPaymentIntentResult(
        {
          processorPaymentId: 'pi_1',
          clientSecret: 'cs_1',
          publishableKey: 'pk_1',
          accountId: 'acct_1',
        },
        'cus_1',
      ),
    ).toEqual({
      processorPaymentId: 'pi_1',
      clientSecret: 'cs_1',
      publishableKey: 'pk_1',
      accountId: 'acct_1',
      customerRef: 'cus_1',
    })
  })

  it('omits accountId when undefined (skip-absent)', () => {
    const projected = projectPaymentIntentResult(
      {
        processorPaymentId: 'pi_1',
        clientSecret: 'cs_1',
        publishableKey: 'pk_1',
      },
      'cus_1',
    )
    expect(projected).toEqual({
      processorPaymentId: 'pi_1',
      clientSecret: 'cs_1',
      publishableKey: 'pk_1',
      customerRef: 'cus_1',
    })
    expect('accountId' in projected).toBe(false)
  })
})

describe('projectTopupProcessOutcome', () => {
  it('returns timeout with message when present', () => {
    expect(projectTopupProcessOutcome('timeout', 'Webhook delayed')).toEqual({
      status: 'timeout',
      message: 'Webhook delayed',
    })
  })

  it('omits timeout message when absent (skip-absent)', () => {
    const result = projectTopupProcessOutcome('timeout', undefined)
    expect(result).toEqual({ status: 'timeout' })
    expect(result && 'message' in result).toBe(false)
  })

  it('returns failed for failed status', () => {
    expect(projectTopupProcessOutcome('failed')).toEqual({ status: 'failed' })
  })

  it('returns cancelled for cancelled status', () => {
    expect(projectTopupProcessOutcome('cancelled')).toEqual({ status: 'cancelled' })
  })

  it('fails closed on unknown status', () => {
    expect(projectTopupProcessOutcome('processing')).toEqual({ status: 'failed' })
  })

  it('fails closed on missing status', () => {
    expect(projectTopupProcessOutcome(undefined)).toEqual({ status: 'failed' })
  })

  it('returns succeeded marker without creditsAdded', () => {
    expect(projectTopupProcessOutcome('succeeded')).toEqual({ status: 'succeeded' })
  })
})
