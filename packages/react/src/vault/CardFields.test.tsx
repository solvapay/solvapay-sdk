/**
 * @vitest-environment jsdom
 *
 * The host-DOM half of vault card entry: labels, per-field validation
 * messages driven by VGS Collect's field state, `data-state` on each field
 * wrapper for host CSS, brand icon / validations / autocomplete passed to
 * the hosted fields, and the appearance → Collect css bridge.
 */
import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { createFakeCollect, type FakeCollectForm, type FakeCollectHandle } from '../../../test-utils/src/fake-collect'
import { VaultCardFields } from './CardFields'
import { configureCollect } from './collect'
import { buildCollectFieldCss, mergeCollectCss } from './collectAppearance'
import { enCopy } from '../i18n/en'

const vault = { tenantId: 'tntr4ol0cbq', environment: 'sandbox' as const }

const STOCK_CSS = buildCollectFieldCss(undefined)
const CLASSES = { invalid: 'invalid', valid: 'valid', empty: 'empty', focused: 'focused', dirty: 'dirty', touched: 'touched' }

function expectedOptions(css: Record<string, unknown> = STOCK_CSS, extra: Record<string, unknown> = {}) {
  return {
    cardholderName: {
      ...extra,
      css,
      classes: CLASSES,
      name: 'cardholder_name',
      placeholder: 'Full name',
      validations: ['required'],
      autoComplete: 'cc-name',
      ariaLabel: 'Name on card',
    },
    cardNumber: {
      ...extra,
      css,
      classes: CLASSES,
      name: 'card_number',
      placeholder: '1234 1234 1234 1234',
      validations: ['required', 'validCardNumber'],
      autoComplete: 'cc-number',
      inputMode: 'numeric',
      ariaLabel: 'Card number',
      showCardIcon: true,
    },
    expiry: {
      ...extra,
      css,
      classes: CLASSES,
      name: 'card_exp',
      placeholder: 'MM / YY',
      validations: ['required', 'validCardExpirationDate'],
      autoComplete: 'cc-exp',
      inputMode: 'numeric',
      ariaLabel: 'Expiration date',
      yearLength: 2,
    },
    cvc: {
      ...extra,
      css,
      classes: CLASSES,
      name: 'card_cvc',
      placeholder: 'CVC',
      validations: ['required', 'validCardSecurityCode'],
      autoComplete: 'cc-csc',
      inputMode: 'numeric',
      ariaLabel: 'Security code',
    },
  }
}

function renderFields(props: Partial<React.ComponentProps<typeof VaultCardFields>> = {}) {
  const onCapture = vi.fn()
  const onComplete = vi.fn()
  const onActive = vi.fn()
  const utils = render(
    <VaultCardFields
      vault={vault}
      paymentIntentId="pi_sp_1"
      onCapture={onCapture}
      onComplete={onComplete}
      onActive={onActive}
      data-testid="fields"
      {...props}
    />,
  )
  return { onCapture, onComplete, onActive, ...utils }
}

const section = () => screen.getByTestId('fields')
const field = (name: string) => document.querySelector(`[data-solvapay-card-field="${name}"]`) as HTMLElement
const inputOf = (name: string) => field(name).querySelector('[data-solvapay-card-field-input]') as HTMLElement
const labelOf = (name: string) => field(name).querySelector('[data-solvapay-card-field-label]')?.textContent ?? null
const errorOf = (name: string) => field(name).querySelector('[data-solvapay-card-field-error]')?.textContent ?? null
const alertOf = (name: string) => field(name).querySelector('[role="alert"]') as HTMLElement | null
const spinner = () => section().querySelector('[data-solvapay-payment-form-loading]')
const ready = () => waitFor(() => expect(section()).toHaveAttribute('data-state', 'ready'))

type SpiedForm = FakeCollectForm & {
  cardNumberField: ReturnType<typeof vi.fn>
  cardExpirationDateField: ReturnType<typeof vi.fn>
  cardCVCField: ReturnType<typeof vi.fn>
  cardholderNameField: ReturnType<typeof vi.fn>
}

describe('VaultCardFields', () => {
  let collect: FakeCollectHandle
  let loader: ReturnType<typeof vi.fn>
  let restore: () => void

  beforeEach(() => {
    collect = createFakeCollect()
    loader = vi.fn(async (opts: Parameters<FakeCollectHandle['loader']>[0]) => {
      const form = await collect.loader(opts)
      for (const method of ['cardNumberField', 'cardExpirationDateField', 'cardCVCField', 'cardholderNameField'] as const) {
        const original = form[method]
        form[method] = vi.fn((el, options) => original(el, options)) as never
      }
      return form
    })
    restore = configureCollect(loader as never)
  })
  afterEach(() => restore())

  it('renders labels and mounts number, expiry and CVC into their wrappers with Elements-grade field options', async () => {
    const { onActive, onCapture, onComplete } = renderFields()

    // Before Collect resolves: loading state with a spinner, every field empty.
    expect(section()).toHaveAttribute('data-state', 'loading')
    expect(spinner()).not.toBeNull()
    expect(section()).toHaveAttribute('data-solvapay-card-fields', '')

    await ready()
    expect(spinner()).toBeNull()
    expect(section().querySelector('[data-solvapay-payment-form-error]')).toBeNull()

    expect(loader).toHaveBeenCalledTimes(1)
    expect(loader.mock.calls[0][0]).toMatchObject({ vaultId: 'tntr4ol0cbq', env: 'sandbox' })
    expect(typeof loader.mock.calls[0][0].stateCallback).toBe('function')

    expect(onActive).toHaveBeenCalledTimes(1)
    expect(onActive).toHaveBeenCalledWith(true)
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(typeof onCapture.mock.calls[0][0]).toBe('function')
    // One state emission per mounted field, each incomplete.
    expect(onComplete.mock.calls).toEqual([[false], [false], [false]])

    expect(labelOf('cardNumber')).toBe('Card number')
    expect(labelOf('expiry')).toBe('Expiration date')
    expect(labelOf('cvc')).toBe('Security code')
    expect(field('cardholderName')).toBeNull()
    expect(screen.queryByText('Name on card')).toBeNull()
    for (const name of ['cardNumber', 'expiry', 'cvc']) {
      expect(field(name)).toHaveAttribute('data-state', 'empty')
      expect(errorOf(name)).toBeNull()
      expect(inputOf(name).getAttribute('aria-describedby')).toBeNull()
    }
    // Expiry and CVC share a row; the number sits above it.
    const row = section().querySelector('[data-solvapay-card-field-row]') as HTMLElement
    expect(Array.from(row.children)).toEqual([field('expiry'), field('cvc')])
    expect(Array.from(section().children)).toEqual([field('cardNumber'), row])

    const form = collect.forms[0] as SpiedForm
    expect(form.mounted).toEqual(['card_number', 'card_exp', 'card_cvc'])
    const expected = expectedOptions()
    expect(form.cardNumberField).toHaveBeenCalledTimes(1)
    expect(form.cardNumberField).toHaveBeenCalledWith(inputOf('cardNumber'), expected.cardNumber)
    expect(form.cardExpirationDateField).toHaveBeenCalledTimes(1)
    expect(form.cardExpirationDateField).toHaveBeenCalledWith(inputOf('expiry'), expected.expiry)
    expect(form.cardCVCField).toHaveBeenCalledTimes(1)
    expect(form.cardCVCField).toHaveBeenCalledWith(inputOf('cvc'), expected.cvc)
    expect(form.cardholderNameField).not.toHaveBeenCalled()
    expect(form.fieldOptions.card_number.css).toStrictEqual(STOCK_CSS)
  })

  it('captures through the mounted form with the grant token and the payment id as meta', async () => {
    const { onCapture } = renderFields()
    await ready()
    const capture = onCapture.mock.calls[0][0] as (grant: { token: string }) => Promise<unknown>
    const grant = { token: 'vgs-collect-token', tenantId: 'tntr4ol0cbq', environment: 'sandbox' as const, expiresAt: 1, scope: { paymentIntentId: 'pi_sp_1' } }
    const card = await capture(grant)
    expect(collect.cards).toHaveLength(1)
    expect(collect.cards[0]).toStrictEqual({
      id: 'CRD_fake_1',
      meta: { paymentIntentId: 'pi_sp_1' },
      auth: 'vgs-collect-token',
      attributes: { last4: '4242', card_brand: 'VISA', exp_month: 12, exp_year: 30 },
    })
    expect(card).toStrictEqual({ cardId: 'CRD_fake_1', last4: '4242', brand: 'VISA', expMonth: 12, expYear: 2030 })
  })

  it('shows a validation message only once a field is touched and invalid, keyed on the VGS error code', async () => {
    const { onComplete } = renderFields()
    await ready()

    // Untouched and empty: no error, state empty.
    expect(errorOf('cardNumber')).toBeNull()
    expect(field('cardNumber')).toHaveAttribute('data-state', 'empty')

    // Focused while still empty: focused, no error.
    act(() => collect.setFieldState('card_number', { isFocused: true, isEmpty: true, isValid: false }))
    expect(field('cardNumber')).toHaveAttribute('data-state', 'focused')
    expect(errorOf('cardNumber')).toBeNull()

    // Typing an invalid number while focused: still no error (not touched).
    act(() => collect.setFieldState('card_number', { isFocused: true, isEmpty: false, isValid: false, errors: [{ code: 1011 }] }))
    expect(errorOf('cardNumber')).toBeNull()
    expect(field('cardNumber')).toHaveAttribute('data-state', 'focused')

    // Blur: touched + invalid → our copy for 1011, not VGS's text.
    act(() => collect.setFieldState('card_number', { isFocused: false, isTouched: true, isValid: false, isEmpty: false, errors: [{ code: 1011, message: 'is not a valid card number' }] }))
    expect(errorOf('cardNumber')).toBe('Your card number is invalid.')
    expect(errorOf('cardNumber')).toBe(enCopy.cardFields.errors.invalidNumber)
    expect(field('cardNumber')).toHaveAttribute('data-state', 'invalid')
    const alert = alertOf('cardNumber')!
    expect(alert.tagName).toBe('P')
    expect(alert.id).toBe('solvapay-card-field-cardNumber-error')
    expect(alert).toHaveAttribute('data-solvapay-card-field-error', '')
    expect(inputOf('cardNumber')).toHaveAttribute('aria-describedby', 'solvapay-card-field-cardNumber-error')
    expect(screen.queryByText('is not a valid card number')).toBeNull()

    // Expiry and CVC codes map to their own messages; required when left empty.
    act(() => collect.setFieldState('card_exp', { isTouched: true, isValid: false, isEmpty: false, errors: [{ code: 1015 }] }))
    act(() => collect.setFieldState('card_cvc', { isTouched: true, isValid: false, isEmpty: true, errors: [{ code: 1001 }] }))
    expect(errorOf('expiry')).toBe("Your card's expiration date is invalid.")
    expect(field('expiry')).toHaveAttribute('data-state', 'invalid')
    expect(errorOf('cvc')).toBe('This field is required.')
    expect(field('cvc')).toHaveAttribute('data-state', 'invalid')
    expect(alertOf('expiry')!.id).toBe('solvapay-card-field-expiry-error')
    expect(alertOf('cvc')!.id).toBe('solvapay-card-field-cvc-error')

    act(() => collect.setFieldState('card_cvc', { isTouched: true, isValid: false, isEmpty: false, errors: [{ code: 1017 }] }))
    expect(errorOf('cvc')).toBe("Your card's security code is invalid.")

    // Unknown VGS code → generic invalid copy; touched-empty without a code → required.
    act(() => collect.setFieldState('card_cvc', { isTouched: true, isValid: false, isEmpty: false, errors: [{ code: 9999 }] }))
    expect(errorOf('cvc')).toBe('This value is invalid.')
    act(() => collect.setFieldState('card_cvc', { isTouched: true, isValid: false, isEmpty: true, errors: [] }))
    expect(errorOf('cvc')).toBe('This field is required.')

    // Touched-empty always wins over a known (or unknown) VGS code: empty is "required", never "invalid".
    act(() => collect.setFieldState('card_number', { isTouched: true, isValid: false, isEmpty: true, errors: [{ code: 1011 }] }))
    expect(errorOf('cardNumber')).toBe('This field is required.')
    expect(field('cardNumber')).toHaveAttribute('data-state', 'invalid')
    act(() => collect.setFieldState('card_exp', { isTouched: true, isValid: false, isEmpty: true, errors: [{ code: 1015 }] }))
    expect(errorOf('expiry')).toBe('This field is required.')
    act(() => collect.setFieldState('card_cvc', { isTouched: true, isValid: false, isEmpty: true, errors: [{ code: 9999 }] }))
    expect(errorOf('cvc')).toBe('This field is required.')

    // Fixing the number clears its message and marks it valid.
    act(() => collect.setFieldState('card_number', { isTouched: true, isValid: true, isEmpty: false, errors: [] }))
    expect(errorOf('cardNumber')).toBeNull()
    expect(alertOf('cardNumber')).toBeNull()
    expect(inputOf('cardNumber').getAttribute('aria-describedby')).toBeNull()
    expect(field('cardNumber')).toHaveAttribute('data-state', 'valid')

    // The form is complete only when every field is valid.
    expect(onComplete).toHaveBeenLastCalledWith(false)
    expect(onComplete).not.toHaveBeenCalledWith(true)
    act(() => collect.enter())
    expect(onComplete).toHaveBeenLastCalledWith(true)
    for (const name of ['cardNumber', 'expiry', 'cvc']) {
      expect(field(name)).toHaveAttribute('data-state', 'valid')
      expect(errorOf(name)).toBeNull()
    }
    act(() => collect.clear())
    expect(onComplete).toHaveBeenLastCalledWith(false)
    expect(field('cardNumber')).toHaveAttribute('data-state', 'invalid')
    expect(errorOf('cardNumber')).toBe('This field is required.')
  })

  it('renders the optional cardholder name field first with its own hosted options and validation', async () => {
    renderFields({ cardholderName: true })
    await ready()
    const form = collect.forms[0] as SpiedForm
    expect(form.mounted).toEqual(['cardholder_name', 'card_number', 'card_exp', 'card_cvc'])
    expect(form.cardholderNameField).toHaveBeenCalledTimes(1)
    expect(form.cardholderNameField).toHaveBeenCalledWith(inputOf('cardholderName'), expectedOptions().cardholderName)
    expect(labelOf('cardholderName')).toBe('Name on card')
    expect(section().firstElementChild).toBe(field('cardholderName'))
    expect(field('cardholderName')).toHaveAttribute('data-state', 'empty')

    act(() => collect.setFieldState('cardholder_name', { isTouched: true, isValid: false, isEmpty: true, errors: [{ code: 1001 }] }))
    expect(errorOf('cardholderName')).toBe('This field is required.')
    expect(field('cardholderName')).toHaveAttribute('data-state', 'invalid')
    expect(alertOf('cardholderName')!.id).toBe('solvapay-card-field-cardholderName-error')
  })

  it('reports a Collect load failure with the SDK copy and never hands the form a capture function', async () => {
    restore()
    const failure = new Error('cdn down')
    configureCollect(async () => {
      throw failure
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { onCapture, onComplete, onActive } = renderFields({ paymentIntentId: 'pi_sp_2' })
      await waitFor(() => expect(section()).toHaveAttribute('data-state', 'error'))
      const alert = section().querySelector('[data-solvapay-payment-form-error]') as HTMLElement
      expect(alert.textContent).toBe('Card fields are not ready. Please refresh the page.')
      expect(alert).toHaveAttribute('role', 'alert')
      expect(spinner()).toBeNull()
      expect(onCapture).not.toHaveBeenCalled()
      expect(onComplete).not.toHaveBeenCalled()
      expect(onActive).toHaveBeenCalledTimes(1)
      expect(onActive).toHaveBeenCalledWith(true)
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith('[CardFields] VGS Collect failed to load', failure)
      expect(collect.forms).toHaveLength(0)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('threads appearance and fieldCss into the hosted fields, fieldCss winning', async () => {
    const appearance = { variables: { colorText: 'rgb(1, 2, 3)', fontFamily: 'Inter' } }
    const fieldCss = { fontFamily: 'Georgia', '&:focus': { borderColor: 'lime' } }
    renderFields({
      appearance,
      fieldCss,
      placeholders: { cardNumber: '0000 0000 0000 0000' },
      cardIcon: false,
      fieldOptions: { hideValue: true },
    })
    await ready()
    const css = mergeCollectCss(buildCollectFieldCss(appearance), fieldCss)
    expect(css).toMatchObject({ color: 'rgb(1, 2, 3)', fontFamily: 'Georgia', '&:focus': { borderColor: 'lime', boxShadow: '0 0 0 1px #0570de' } })

    const form = collect.forms[0] as SpiedForm
    const expected = expectedOptions(css, { hideValue: true })
    expect(form.cardNumberField).toHaveBeenCalledWith(inputOf('cardNumber'), {
      ...expected.cardNumber,
      placeholder: '0000 0000 0000 0000',
      showCardIcon: false,
    })
    expect(form.cardExpirationDateField).toHaveBeenCalledWith(inputOf('expiry'), expected.expiry)
    expect(form.cardCVCField).toHaveBeenCalledWith(inputOf('cvc'), expected.cvc)
  })

  it('builds a dark-theme css from appearance variables and remounts the hosted fields only when the theme changes', async () => {
    const light = { variables: { colorBackground: '#ffffff', colorText: '#111111' } }
    const dark = { theme: 'night' as const, variables: { colorBackground: '#000000', colorText: '#ffffff', colorBorder: '#333333' } }
    const props = { vault, paymentIntentId: 'pi_sp_1', onCapture: vi.fn(), onComplete: vi.fn(), onActive: vi.fn(), 'data-testid': 'fields' }
    const { rerender } = render(<VaultCardFields {...props} appearance={light} />)
    await ready()
    expect(collect.forms).toHaveLength(1)
    expect(collect.forms[0].fieldOptions.card_number.css).toStrictEqual(buildCollectFieldCss(light))
    expect(collect.forms[0].fieldOptions.card_number.css).toMatchObject({ backgroundColor: '#ffffff', color: '#111111' })

    // Same theme, new object identity: no remount.
    rerender(<VaultCardFields {...props} appearance={{ ...light, variables: { ...light.variables } }} />)
    await act(async () => {})
    expect(collect.forms).toHaveLength(1)
    expect(collect.forms[0].unmounted).toBe(false)

    rerender(<VaultCardFields {...props} appearance={dark} />)
    await waitFor(() => expect(collect.forms).toHaveLength(2))
    await ready()
    expect(collect.forms[0].unmounted).toBe(true)
    expect(collect.forms[1].unmounted).toBe(false)
    expect(collect.forms[1].fieldOptions.card_number.css).toStrictEqual(buildCollectFieldCss(dark))
    expect(collect.forms[1].fieldOptions.card_number.css).toMatchObject({
      backgroundColor: '#000000',
      color: '#ffffff',
      border: '1px solid #333333',
    })
    expect(props.onCapture).toHaveBeenCalledTimes(3)
    expect(props.onCapture.mock.calls[1]).toEqual([null])
    expect(typeof props.onCapture.mock.calls[2][0]).toBe('function')
  })

  it('hides labels when labels=false and keeps the hosted inputs and error slots', async () => {
    renderFields({ labels: false })
    await ready()
    expect(section().querySelectorAll('[data-solvapay-card-field-label]')).toHaveLength(0)
    expect(section().querySelectorAll('[data-solvapay-card-field-input]')).toHaveLength(3)
    expect(collect.forms[0].fieldOptions.card_number.ariaLabel).toBe('Card number')
  })

  it('renders nothing without a vault or payment id and unmounts the hosted form on unmount', async () => {
    const noVault = renderFields({ vault: null })
    expect(noVault.container.innerHTML).toBe('')
    expect(noVault.onActive).not.toHaveBeenCalled()
    expect(noVault.onCapture).not.toHaveBeenCalled()
    expect(loader).not.toHaveBeenCalled()
    noVault.unmount()

    const noIntent = renderFields({ paymentIntentId: null })
    expect(noIntent.container.innerHTML).toBe('')
    expect(noIntent.onActive).not.toHaveBeenCalled()
    expect(loader).not.toHaveBeenCalled()
    noIntent.unmount()

    const mounted = renderFields()
    await ready()
    expect(collect.forms).toHaveLength(1)
    mounted.unmount()
    expect(collect.forms[0].unmounted).toBe(true)
    expect(mounted.onCapture).toHaveBeenCalledTimes(2)
    expect(mounted.onCapture).toHaveBeenLastCalledWith(null)
    expect(mounted.onComplete).toHaveBeenLastCalledWith(false)
    expect(mounted.onActive.mock.calls).toEqual([[true], [false]])
  })
})
