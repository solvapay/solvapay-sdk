import { describe, expect, it, vi } from 'vitest'
import { confirmVaultPayment } from './confirmPayment'
import { CardCaptureError } from '../vault/collect'
import { enCopy } from '../i18n/en'

const grant = {
  token: 'vgs-token',
  tenantId: 'tntr4ol0cbq',
  environment: 'sandbox' as const,
  expiresAt: Date.now() + 60_000,
  scope: { paymentIntentId: 'pi_sp_1' },
}

const succeededPayment = {
  id: 'pi_sp_1',
  processorPaymentId: 'pi_rail_1',
  status: 'succeeded' as const,
}

type ConfirmDeps = Parameters<typeof confirmVaultPayment>[0]

/** The deps with the three calls as mocks, so the tests can read their call order. */
function deps(overrides: Partial<ConfirmDeps> = {}) {
  const base = {
    paymentIntentId: 'pi_sp_1',
    capture: vi.fn<ConfirmDeps['capture']>().mockResolvedValue({
      cardId: 'CRD1',
      last4: '4242',
      brand: 'VISA',
      expMonth: 12,
      expYear: 2030,
    }),
    createCaptureGrant: vi.fn<ConfirmDeps['createCaptureGrant']>().mockResolvedValue(grant),
    confirmPayment: vi.fn<ConfirmDeps['confirmPayment']>().mockResolvedValue(succeededPayment),
    returnUrl: 'https://app.example/return',
    copy: enCopy,
  }
  return Object.assign(base, overrides)
}

describe('confirmVaultPayment', () => {
  it('grants, captures into the vault, then confirms server-side with the card id', async () => {
    const d = deps()
    const result = await confirmVaultPayment(d)
    expect(d.createCaptureGrant).toHaveBeenCalledTimes(1)
    expect(d.createCaptureGrant).toHaveBeenCalledWith({ paymentIntentId: 'pi_sp_1' })
    expect(d.capture).toHaveBeenCalledTimes(1)
    expect(d.capture).toHaveBeenCalledWith(grant)
    expect(d.confirmPayment).toHaveBeenCalledTimes(1)
    expect(d.confirmPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_sp_1',
      cardId: 'CRD1',
      returnUrl: 'https://app.example/return',
    })
    expect(d.createCaptureGrant.mock.invocationCallOrder[0]).toBeLessThan(
      d.capture.mock.invocationCallOrder[0],
    )
    expect(d.capture.mock.invocationCallOrder[0]).toBeLessThan(
      d.confirmPayment.mock.invocationCallOrder[0],
    )
    expect(result).toStrictEqual({ status: 'succeeded', payment: succeededPayment })
  })

  it('pays with a saved payment method without touching the vault', async () => {
    const d = deps({ paymentMethodId: 'pm_saved' })
    const result = await confirmVaultPayment(d)
    expect(d.createCaptureGrant).not.toHaveBeenCalled()
    expect(d.capture).not.toHaveBeenCalled()
    expect(d.confirmPayment).toHaveBeenCalledTimes(1)
    expect(d.confirmPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_sp_1',
      paymentMethodId: 'pm_saved',
      returnUrl: 'https://app.example/return',
    })
    expect(result).toStrictEqual({ status: 'succeeded', payment: succeededPayment })
  })

  it('omits returnUrl from the confirm call when none is given', async () => {
    const d = deps({ returnUrl: undefined })
    await confirmVaultPayment(d)
    expect(d.confirmPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_sp_1',
      cardId: 'CRD1',
      returnUrl: undefined,
    })
  })

  it('surfaces a 3DS redirect with the payment and the 3DS copy', async () => {
    const payment = {
      id: 'pi_sp_1',
      processorPaymentId: 'pi_rail_1',
      status: 'requires_action' as const,
      redirectUrl: 'https://acs.bank.test/3ds',
    }
    const d = deps({ confirmPayment: vi.fn().mockResolvedValue(payment) })
    const result = await confirmVaultPayment(d)
    expect(result).toStrictEqual({
      status: 'requires_action',
      message: enCopy.errors.paymentRequires3ds,
      redirectUrl: 'https://acs.bank.test/3ds',
      payment,
    })
  })

  it('fails requires_action without a redirect url with the authentication-unavailable copy', async () => {
    const payment = {
      id: 'pi_sp_1',
      processorPaymentId: 'pi_rail_1',
      status: 'requires_action' as const,
    }
    const result = await confirmVaultPayment(
      deps({ confirmPayment: vi.fn().mockResolvedValue(payment) }),
    )
    expect(result).toStrictEqual({
      status: 'error',
      message: enCopy.errors.authenticationUnavailable,
    })
    expect(enCopy.errors.authenticationUnavailable).toBe(
      'Your bank asked for additional authentication, but no authentication page was provided. Please try another card or contact support.',
    )
  })

  it('treats an empty redirect url on requires_action the same as a missing one', async () => {
    const payment = {
      id: 'pi_sp_1',
      processorPaymentId: 'pi_rail_1',
      status: 'requires_action' as const,
      redirectUrl: '',
    }
    const result = await confirmVaultPayment(
      deps({ confirmPayment: vi.fn().mockResolvedValue(payment) }),
    )
    expect(result).toStrictEqual({
      status: 'error',
      message: enCopy.errors.authenticationUnavailable,
    })
  })

  it('maps processing and pending to pending with the payment attached', async () => {
    for (const status of ['processing', 'pending'] as const) {
      const payment = { id: 'a', processorPaymentId: 'b', status }
      const result = await confirmVaultPayment(
        deps({ confirmPayment: vi.fn().mockResolvedValue(payment) }),
      )
      expect(result).toStrictEqual({
        status: 'pending',
        message: enCopy.errors.paymentPending,
        payment,
      })
    }
  })

  it('maps failed and requires_payment_method to the processing-failed error', async () => {
    for (const status of ['failed', 'requires_payment_method'] as const) {
      const payment = { id: 'a', processorPaymentId: 'b', status }
      const result = await confirmVaultPayment(
        deps({ confirmPayment: vi.fn().mockResolvedValue(payment) }),
      )
      expect(result).toStrictEqual({
        status: 'error',
        message: enCopy.errors.paymentProcessingFailed,
      })
    }
  })

  it('reports any other status verbatim through the status-prefix copy', async () => {
    const payment = { id: 'a', processorPaymentId: 'b', status: 'canceled' as never }
    const result = await confirmVaultPayment(
      deps({ confirmPayment: vi.fn().mockResolvedValue(payment) }),
    )
    expect(result).toStrictEqual({ status: 'other', message: 'Payment status: canceled', payment })
  })

  it('reports an unexpected error when the backend returns no payment or no processor id', async () => {
    expect(
      await confirmVaultPayment(deps({ confirmPayment: vi.fn().mockResolvedValue(undefined) })),
    ).toStrictEqual({
      status: 'error',
      message: enCopy.errors.paymentUnexpected,
    })
    expect(
      await confirmVaultPayment(
        deps({ confirmPayment: vi.fn().mockResolvedValue({ id: 'a', status: 'succeeded' }) }),
      ),
    ).toStrictEqual({ status: 'error', message: enCopy.errors.paymentUnexpected })
  })

  it('reports a vault capture failure with the card copy, not the raw error', async () => {
    const d = deps({ capture: vi.fn().mockRejectedValue(new CardCaptureError('boom', 422)) })
    const result = await confirmVaultPayment(d)
    expect(result).toStrictEqual({ status: 'error', message: enCopy.errors.cardCaptureFailed })
    expect(d.createCaptureGrant).toHaveBeenCalledTimes(1)
    expect(d.confirmPayment).not.toHaveBeenCalled()
  })

  it('passes grant failures through as messages and never captures or confirms', async () => {
    const d = deps({
      createCaptureGrant: vi.fn().mockRejectedValue(new Error('Grant limit reached')),
    })
    expect(await confirmVaultPayment(d)).toStrictEqual({
      status: 'error',
      message: 'Grant limit reached',
    })
    expect(d.capture).not.toHaveBeenCalled()
    expect(d.confirmPayment).not.toHaveBeenCalled()
  })

  it('passes confirm transport errors through as messages', async () => {
    const d = deps({
      confirmPayment: vi.fn().mockRejectedValue(new Error('Failed to confirm payment: 502')),
    })
    expect(await confirmVaultPayment(d)).toStrictEqual({
      status: 'error',
      message: 'Failed to confirm payment: 502',
    })
  })

  it('falls back to the unexpected-error copy when a non-Error is thrown', async () => {
    const d = deps({ confirmPayment: vi.fn().mockRejectedValue('nope') })
    expect(await confirmVaultPayment(d)).toStrictEqual({
      status: 'error',
      message: enCopy.errors.paymentUnexpected,
    })
  })
})
