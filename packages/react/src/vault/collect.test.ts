/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CardCaptureError,
  VGS_COLLECT_SCRIPT_URL,
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
  it('sends the grant token with empty data (no meta), and maps the CMP card object', async () => {
    const createCard = vi.fn<CollectForm['createCard']>((opts, onResponse) => {
      onResponse(201, {
        data: {
          id: 'CRD1',
          attributes: { last4: '4242', card_brand: 'VISA', exp_month: 12, exp_year: 30 },
        },
      })
    })
    const card = await captureCard(fakeForm({ createCard }), { token: 'tok' })
    expect(createCard).toHaveBeenCalledTimes(1)
    // Collect writes its own card meta; the SDK sends none.
    expect(createCard.mock.calls[0][0]).toStrictEqual({ auth: 'tok', data: {} })
    expect(typeof createCard.mock.calls[0][1]).toBe('function')
    expect(typeof createCard.mock.calls[0][2]).toBe('function')
    expect(card).toEqual({
      cardId: 'CRD1',
      last4: '4242',
      brand: 'VISA',
      expMonth: 12,
      expYear: 2030,
    })
  })

  it('keeps a four-digit exp_year as is and accepts string month/year', async () => {
    const createCard = vi.fn((_opts, onResponse) => {
      onResponse(200, {
        data: {
          id: 'CRD2',
          attributes: {
            last4: '1111',
            card_brand: 'MASTERCARD',
            exp_month: '07',
            exp_year: '2031',
          },
        },
      })
    })
    const card = await captureCard(fakeForm({ createCard }), { token: 'tok' })
    expect(card).toEqual({
      cardId: 'CRD2',
      last4: '1111',
      brand: 'MASTERCARD',
      expMonth: 7,
      expYear: 2031,
    })
  })

  it('leaves optional card fields undefined when the response carries no attributes', async () => {
    const createCard = vi.fn((_opts, onResponse) => onResponse(201, { data: { id: 'CRD3' } }))
    const card = await captureCard(fakeForm({ createCard }), { token: 'tok' })
    expect(card).toEqual({
      cardId: 'CRD3',
      last4: undefined,
      brand: undefined,
      expMonth: undefined,
      expYear: undefined,
    })
  })

  it('rejects with the status when the vault refuses the card', async () => {
    const createCard = vi.fn((_opts, onResponse) => onResponse(422, { errors: [] }))
    const promise = captureCard(fakeForm({ createCard }), { token: 't' })
    await expect(promise).rejects.toBeInstanceOf(CardCaptureError)
    await expect(promise).rejects.toMatchObject({
      name: 'CardCaptureError',
      message: 'Card capture failed with status 422',
      status: 422,
    })
  })

  it('rejects when the response has no card id, even on a 2xx', async () => {
    const createCard = vi.fn((_opts, onResponse) => onResponse(201, { data: {} }))
    const promise = captureCard(fakeForm({ createCard }), { token: 't' })
    await expect(promise).rejects.toBeInstanceOf(CardCaptureError)
    await expect(promise).rejects.toMatchObject({
      message: 'Card capture failed with status 201',
      status: 201,
    })
  })

  it('rejects on a transport error with the error message and no status', async () => {
    const createCard = vi.fn((_opts, _ok, onError) => onError(new Error('network')))
    const promise = captureCard(fakeForm({ createCard }), { token: 't' })
    await expect(promise).rejects.toBeInstanceOf(CardCaptureError)
    const err = (await promise.catch(e => e)) as CardCaptureError
    expect(err.message).toBe('network')
    expect(err.status).toBeUndefined()
  })

  it('rejects with the generic message when the transport error is not an Error', async () => {
    const createCard = vi.fn((_opts, _ok, onError) => onError('boom'))
    await expect(captureCard(fakeForm({ createCard }), { token: 't' })).rejects.toMatchObject({
      name: 'CardCaptureError',
      message: 'Card capture failed',
      status: undefined,
    })
  })
})

describe('isCollectFormComplete', () => {
  it('is true only when every mounted field is valid', () => {
    expect(isCollectFormComplete(null)).toBe(false)
    expect(isCollectFormComplete(undefined)).toBe(false)
    expect(isCollectFormComplete({})).toBe(false)
    expect(isCollectFormComplete({ a: { isValid: true }, b: { isValid: false } })).toBe(false)
    expect(isCollectFormComplete({ a: { isValid: true }, b: {} })).toBe(false)
    expect(isCollectFormComplete({ a: { isValid: true }, b: { isValid: true } })).toBe(true)
  })
})

describe('configureCollect / CDN loader', () => {
  afterEach(() => {
    configureCollect(null)
    delete (window as { VGSCollect?: unknown }).VGSCollect
    document.querySelectorAll('script').forEach(s => s.remove())
  })

  it('routes createCollectForm through the configured loader and restores on demand', async () => {
    const form = fakeForm()
    const loader = vi.fn().mockResolvedValue(form)
    const restore = configureCollect(loader)
    await expect(createCollectForm({ vaultId: 'tnt', env: 'sandbox' })).resolves.toBe(form)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(loader).toHaveBeenCalledWith({ vaultId: 'tnt', env: 'sandbox' })
    restore()

    const viaCdn = fakeForm()
    const create = vi.fn().mockReturnValue(viaCdn)
    ;(window as { VGSCollect?: unknown }).VGSCollect = { create }
    const stateCallback = vi.fn()
    await expect(
      createCollectForm({ vaultId: 'tnt', env: 'sandbox', stateCallback }),
    ).resolves.toBe(viaCdn)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith('tnt', 'sandbox', stateCallback)
  })

  it('uses create() even when the build offers session(), which needs a dashboard form config', async () => {
    const viaCreate = fakeForm()
    const create = vi.fn().mockReturnValue(viaCreate)
    const session = vi.fn()
    ;(window as { VGSCollect?: unknown }).VGSCollect = { create, session }
    const stateCallback = vi.fn()
    await expect(createCollectForm({ vaultId: 'tnt', env: 'live', stateCallback })).resolves.toBe(
      viaCreate,
    )
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith('tnt', 'live', stateCallback)
    expect(session).not.toHaveBeenCalled()
  })

  it('rejects a Collect build without create()', async () => {
    ;(window as { VGSCollect?: unknown }).VGSCollect = {}
    await expect(createCollectForm({ vaultId: 'tnt', env: 'sandbox' })).rejects.toThrow(
      'Unsupported VGS Collect build: create() is not available',
    )
  })

  it('injects the pinned CDN script once and rejects when it fails to load', async () => {
    const promise = createCollectForm({ vaultId: 'tnt', env: 'sandbox' })
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      `script[src="${VGS_COLLECT_SCRIPT_URL}"]`,
    )
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toBe('https://js.verygoodvault.com/vgs-collect/4.0.1/vgs-collect.js')
    expect(scripts[0].async).toBe(true)
    expect(scripts[0].getAttribute('integrity')).toBe(
      'sha384-Sr5xwyR0H5rcDXa7/iDJDM3qBBvtHuR97A8ELbd+DFBDi32Caf72to9UVqvI8R95',
    )
    expect(scripts[0].getAttribute('crossorigin')).toBe('anonymous')
    expect(scripts[0].parentElement).toBe(document.head)

    scripts[0].dispatchEvent(new Event('error'))
    await expect(promise).rejects.toThrow('Failed to load VGS Collect')
  })

  it('rejects when the script loads without window.VGSCollect, and the next call retries instead of replaying the rejection', async () => {
    const promise = createCollectForm({ vaultId: 'tnt', env: 'sandbox' })
    const script = document.querySelector<HTMLScriptElement>(
      `script[src="${VGS_COLLECT_SCRIPT_URL}"]`,
    )!
    script.dispatchEvent(new Event('load'))
    await expect(promise).rejects.toThrow(
      'VGS Collect script loaded but window.VGSCollect is missing',
    )

    // The rejection is not cached: a later call re-attaches to the same script tag and succeeds once the global exists.
    const retry = createCollectForm({ vaultId: 'tnt', env: 'sandbox' })
    expect(document.querySelectorAll(`script[src="${VGS_COLLECT_SCRIPT_URL}"]`)).toHaveLength(1)
    const form = fakeForm()
    const create = vi.fn().mockReturnValue(form)
    ;(window as { VGSCollect?: unknown }).VGSCollect = { create }
    script.dispatchEvent(new Event('load'))
    await expect(retry).resolves.toBe(form)
    expect(create).toHaveBeenCalledWith('tnt', 'sandbox', undefined)
    // Reset the module-level script cache for the tests that follow.
    script.dispatchEvent(new Event('error'))
  })

  it('resolves through create() once the CDN script defines window.VGSCollect', async () => {
    const promise = createCollectForm({ vaultId: 'tnt', env: 'live' })
    const script = document.querySelector<HTMLScriptElement>(
      `script[src="${VGS_COLLECT_SCRIPT_URL}"]`,
    )!
    const form = fakeForm()
    const create = vi.fn().mockReturnValue(form)
    ;(window as { VGSCollect?: unknown }).VGSCollect = { create }
    script.dispatchEvent(new Event('load'))
    await expect(promise).resolves.toBe(form)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith('tnt', 'live', undefined)
  })
})
