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

function deps(overrides: Partial<Parameters<typeof confirmVaultPayment>[0]> = {}) {
  return {
    paymentIntentId: 'pi_sp_1',
    capture: vi.fn().mockResolvedValue({ cardId: 'CRD1' }),
    createCaptureGrant: vi.fn().mockResolvedValue(grant),
    confirmPayment: vi.fn().mockResolvedValue({
      id: 'pi_sp_1',
      processorPaymentId: 'pi_stripe_1',
      status: 'succeeded',
    }),
    returnUrl: 'https://app.example/return',
    copy: enCopy,
    ...overrides,
  }
}

describe('confirmVaultPayment', () => {
  it('grants, captures into the vault, then confirms server-side with the card id', async () => {
    const d = deps()
    const result = await confirmVaultPayment(d)
    expect(d.createCaptureGrant).toHaveBeenCalledWith({ paymentIntentId: 'pi_sp_1' })
    expect(d.capture).toHaveBeenCalledWith(grant)
    expect(d.confirmPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_sp_1',
      cardId: 'CRD1',
      returnUrl: 'https://app.example/return',
    })
    expect(result).toEqual({
      status: 'succeeded',
      payment: { id: 'pi_sp_1', processorPaymentId: 'pi_stripe_1', status: 'succeeded' },
    })
  })

  it('pays with a saved payment method without touching the vault', async () => {
    const d = deps({ paymentMethodId: 'pm_saved' })
    await confirmVaultPayment(d)
    expect(d.createCaptureGrant).not.toHaveBeenCalled()
    expect(d.capture).not.toHaveBeenCalled()
    expect(d.confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethodId: 'pm_saved' }),
    )
  })

  it('surfaces a 3DS redirect', async () => {
    const d = deps({
      confirmPayment: vi.fn().mockResolvedValue({
        id: 'pi_sp_1',
        processorPaymentId: 'pi_stripe_1',
        status: 'requires_action',
        redirectUrl: 'https://hooks.stripe.com/3ds',
      }),
    })
    const result = await confirmVaultPayment(d)
    expect(result).toMatchObject({ status: 'requires_action', redirectUrl: 'https://hooks.stripe.com/3ds' })
  })

  it('maps processing to pending and a decline to an error', async () => {
    const processing = await confirmVaultPayment(
      deps({
        confirmPayment: vi.fn().mockResolvedValue({ id: 'a', processorPaymentId: 'b', status: 'processing' }),
      }),
    )
    expect(processing).toMatchObject({ status: 'pending', message: enCopy.errors.paymentPending })

    const declined = await confirmVaultPayment(
      deps({
        confirmPayment: vi.fn().mockResolvedValue({ id: 'a', processorPaymentId: 'b', status: 'failed' }),
      }),
    )
    expect(declined).toEqual({ status: 'error', message: enCopy.errors.paymentProcessingFailed })
  })

  it('reports a vault capture failure with the card copy, not the raw error', async () => {
    const d = deps({ capture: vi.fn().mockRejectedValue(new CardCaptureError('boom', 422)) })
    const result = await confirmVaultPayment(d)
    expect(result).toEqual({ status: 'error', message: enCopy.errors.cardCaptureFailed })
    expect(d.confirmPayment).not.toHaveBeenCalled()
  })

  it('passes transport errors through as messages', async () => {
    const d = deps({ createCaptureGrant: vi.fn().mockRejectedValue(new Error('Grant limit reached')) })
    expect(await confirmVaultPayment(d)).toEqual({ status: 'error', message: 'Grant limit reached' })
  })
})
