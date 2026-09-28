/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CardCaptureError,
  captureCard,
  configureCollect,
  createCollectForm,
  isCollectFormComplete,
  type CollectForm,
} from './collect'

function fakeForm(overrides: Partial<CollectForm> = {}): CollectForm {
  return {
    cardNumberField: vi.fn(),
    cardExpirationDateField: vi.fn(),
    cardCVCField: vi.fn(),
    cardholderNameField: vi.fn(),
    createCard: vi.fn(),
    ...overrides,
  }
}

describe('captureCard', () => {
  it('sends the grant token and the meta, and maps the CMP card object', async () => {
    const createCard = vi.fn((opts, onResponse) => {
      onResponse(201, {
        data: {
          id: 'CRD1',
          attributes: { last4: '4242', card_brand: 'VISA', exp_month: 12, exp_year: 30 },
        },
      })
    })
    const card = await captureCard(fakeForm({ createCard }), { token: 'tok' }, { paymentIntentId: 'pi_1' })
    expect(createCard.mock.calls[0][0]).toEqual({ auth: 'tok', data: { meta: { paymentIntentId: 'pi_1' } } })
    expect(card).toEqual({ cardId: 'CRD1', last4: '4242', brand: 'VISA', expMonth: 12, expYear: 2030 })
  })

  it('rejects with the status when the vault refuses the card', async () => {
    const createCard = vi.fn((_opts, onResponse) => onResponse(422, { errors: [] }))
    await expect(captureCard(fakeForm({ createCard }), { token: 't' }, {})).rejects.toMatchObject({
      name: 'CardCaptureError',
      status: 422,
    })
  })

  it('rejects when the response has no card id', async () => {
    const createCard = vi.fn((_opts, onResponse) => onResponse(201, { data: {} }))
    await expect(captureCard(fakeForm({ createCard }), { token: 't' }, {})).rejects.toBeInstanceOf(
      CardCaptureError,
    )
  })

  it('rejects on a transport error', async () => {
    const createCard = vi.fn((_opts, _ok, onError) => onError(new Error('network')))
    await expect(captureCard(fakeForm({ createCard }), { token: 't' }, {})).rejects.toMatchObject({
      message: 'network',
    })
  })
})

describe('isCollectFormComplete', () => {
  it('is true only when every mounted field is valid', () => {
    expect(isCollectFormComplete(null)).toBe(false)
    expect(isCollectFormComplete({})).toBe(false)
    expect(isCollectFormComplete({ a: { isValid: true }, b: { isValid: false } })).toBe(false)
    expect(isCollectFormComplete({ a: { isValid: true }, b: { isValid: true } })).toBe(true)
  })
})

describe('configureCollect / CDN loader', () => {
  afterEach(() => {
    configureCollect(null)
    delete (window as { VGSCollect?: unknown }).VGSCollect
  })

  it('routes createCollectForm through the configured loader and restores on demand', async () => {
    const form = fakeForm()
    const loader = vi.fn().mockResolvedValue(form)
    const restore = configureCollect(loader)
    await expect(createCollectForm({ vaultId: 'tnt', env: 'sandbox' })).resolves.toBe(form)
    expect(loader).toHaveBeenCalledWith({ vaultId: 'tnt', env: 'sandbox' })
    restore()

    const viaCdn = fakeForm()
    const session = vi.fn().mockResolvedValue(viaCdn)
    ;(window as { VGSCollect?: unknown }).VGSCollect = { session }
    await expect(createCollectForm({ vaultId: 'tnt', env: 'sandbox' })).resolves.toBe(viaCdn)
    expect(session).toHaveBeenCalledWith(
      expect.objectContaining({ vaultId: 'tnt', env: 'sandbox', formId: 'solvapay' }),
    )
  })

  it('falls back to the deprecated create() on older Collect builds', async () => {
    const viaCreate = fakeForm()
    const create = vi.fn().mockReturnValue(viaCreate)
    ;(window as { VGSCollect?: unknown }).VGSCollect = { create }
    const stateCallback = vi.fn()
    await expect(createCollectForm({ vaultId: 'tnt', env: 'live', stateCallback })).resolves.toBe(viaCreate)
    expect(create).toHaveBeenCalledWith('tnt', 'live', stateCallback)
  })
})
