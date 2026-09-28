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
import { createFakeCollect, type FakeCollectHandle } from '../../../test-utils/src/fake-collect'
import { VaultCardFields } from './CardFields'
import { configureCollect } from './collect'
import { enCopy } from '../i18n/en'

const vault = { tenantId: 'tntr4ol0cbq', environment: 'sandbox' as const }

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

const field = (name: string) => document.querySelector(`[data-solvapay-card-field="${name}"]`) as HTMLElement
const errorOf = (name: string) => field(name).querySelector('[data-solvapay-card-field-error]')?.textContent ?? null

describe('VaultCardFields', () => {
  let collect: FakeCollectHandle
  let restore: () => void

  beforeEach(() => {
    collect = createFakeCollect()
    restore = configureCollect(collect.loader)
  })
  afterEach(() => restore())

  it('renders labels and mounts number, expiry and CVC with Elements-grade field options', async () => {
    const { onActive, onCapture } = renderFields()
    await waitFor(() => expect(screen.getByTestId('fields')).toHaveAttribute('data-state', 'ready'))

    expect(onActive).toHaveBeenCalledWith(true)
    expect(onCapture).toHaveBeenCalledWith(expect.any(Function))
    expect(screen.getByText(enCopy.cardFields.labels.cardNumber)).toBeInTheDocument()
    expect(screen.getByText(enCopy.cardFields.labels.expiry)).toBeInTheDocument()
    expect(screen.getByText(enCopy.cardFields.labels.cvc)).toBeInTheDocument()
    expect(screen.queryByText(enCopy.cardFields.labels.cardholderName)).toBeNull()

    const form = collect.forms[0]
    expect(form.mounted).toEqual(['card_number', 'card_exp', 'card_cvc'])
    const number = form.fieldOptions.card_number
    expect(number).toMatchObject({
      name: 'card_number',
      validations: ['required', 'validCardNumber'],
      autoComplete: 'cc-number',
      inputMode: 'numeric',
      showCardIcon: true,
      ariaLabel: enCopy.cardFields.labels.cardNumber,
      placeholder: enCopy.cardFields.placeholders.cardNumber,
      classes: expect.objectContaining({ invalid: 'invalid', touched: 'touched' }),
    })
    expect((number.css as Record<string, unknown>)['&:focus']).toBeTruthy()
    expect((number.css as Record<string, unknown>)['&.invalid.touched']).toBeTruthy()
    const expiry = form.fieldOptions.card_exp
    expect(expiry).toMatchObject({ validations: ['required', 'validCardExpirationDate'], autoComplete: 'cc-exp', yearLength: 2 })
    const cvc = form.fieldOptions.card_cvc
    expect(cvc).toMatchObject({ validations: ['required', 'validCardSecurityCode'], autoComplete: 'cc-csc' })
  })

  it('shows a validation message only once a field is touched and invalid, keyed on the VGS error code', async () => {
    const { onComplete } = renderFields()
    await waitFor(() => expect(screen.getByTestId('fields')).toHaveAttribute('data-state', 'ready'))

    // Untouched and empty: no error, state empty.
    expect(errorOf('cardNumber')).toBeNull()
    expect(field('cardNumber')).toHaveAttribute('data-state', 'empty')

    // Typing an invalid number while focused: still no error (not touched).
    act(() => collect.setFieldState('card_number', { isFocused: true, isEmpty: false, isValid: false, errors: [{ code: 1011 }] }))
    expect(errorOf('cardNumber')).toBeNull()
    expect(field('cardNumber')).toHaveAttribute('data-state', 'focused')

    // Blur: touched + invalid → our copy for 1011, not VGS's text.
    act(() => collect.setFieldState('card_number', { isFocused: false, isTouched: true, isValid: false, isEmpty: false, errors: [{ code: 1011, message: 'is not a valid card number' }] }))
    expect(errorOf('cardNumber')).toBe(enCopy.cardFields.errors.invalidNumber)
    expect(field('cardNumber')).toHaveAttribute('data-state', 'invalid')
    expect(field('cardNumber').querySelector('[role="alert"]')).toBeTruthy()

    // Expiry and CVC codes map to their own messages; required when left empty.
    act(() => collect.setFieldState('card_exp', { isTouched: true, isValid: false, isEmpty: false, errors: [{ code: 1015 }] }))
    act(() => collect.setFieldState('card_cvc', { isTouched: true, isValid: false, isEmpty: true, errors: [{ code: 1001 }] }))
    expect(errorOf('expiry')).toBe(enCopy.cardFields.errors.invalidExpiry)
    expect(errorOf('cvc')).toBe(enCopy.cardFields.errors.required)

    // Fixing the number clears its message and marks it valid.
    act(() => collect.setFieldState('card_number', { isTouched: true, isValid: true, isEmpty: false, errors: [] }))
    expect(errorOf('cardNumber')).toBeNull()
    expect(field('cardNumber')).toHaveAttribute('data-state', 'valid')

    // The form is complete only when every field is valid.
    expect(onComplete).not.toHaveBeenLastCalledWith(true)
    act(() => collect.enter())
    expect(onComplete).toHaveBeenLastCalledWith(true)
  })

  it('renders the optional cardholder name field first and reports a Collect load failure', async () => {
    renderFields({ cardholderName: true })
    await waitFor(() => expect(screen.getByTestId('fields')).toHaveAttribute('data-state', 'ready'))
    expect(collect.forms[0].mounted).toEqual(['cardholder_name', 'card_number', 'card_exp', 'card_cvc'])
    expect(screen.getByText(enCopy.cardFields.labels.cardholderName)).toBeInTheDocument()

    restore()
    configureCollect(async () => {
      throw new Error('cdn down')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { onCapture } = renderFields({ paymentIntentId: 'pi_sp_2' })
    await waitFor(() => expect(screen.getAllByTestId('fields')[1]).toHaveAttribute('data-state', 'error'))
    expect(screen.getByText(enCopy.errors.cardFieldsMissing)).toBeInTheDocument()
    expect(onCapture).not.toHaveBeenCalledWith(expect.any(Function))
    errorSpy.mockRestore()
  })

  it('threads appearance and fieldCss into the hosted fields, fieldCss winning', async () => {
    renderFields({
      appearance: { variables: { colorText: 'rgb(1, 2, 3)', fontFamily: 'Inter' } },
      fieldCss: { fontFamily: 'Georgia', '&:focus': { borderColor: 'lime' } },
      placeholders: { cardNumber: '0000 0000 0000 0000' },
      cardIcon: false,
    })
    await waitFor(() => expect(screen.getByTestId('fields')).toHaveAttribute('data-state', 'ready'))
    const number = collect.forms[0].fieldOptions.card_number
    const css = number.css as Record<string, unknown>
    expect(css.color).toBe('rgb(1, 2, 3)')
    expect(css.fontFamily).toBe('Georgia')
    expect((css['&:focus'] as Record<string, unknown>).borderColor).toBe('lime')
    expect(number.placeholder).toBe('0000 0000 0000 0000')
    expect(number.showCardIcon).toBe(false)
  })

  it('renders nothing without a vault or payment id and unmounts the hosted form on unmount', async () => {
    const { container } = renderFields({ vault: null })
    expect(container.firstChild).toBeNull()

    const mounted = renderFields()
    await waitFor(() => expect(screen.getByTestId('fields')).toHaveAttribute('data-state', 'ready'))
    mounted.unmount()
    expect(collect.forms[0].unmounted).toBe(true)
    expect(mounted.onCapture).toHaveBeenLastCalledWith(null)
  })
})
