'use client'

/**
 * Vault-mode card entry shared by `PaymentForm.CardFields` and
 * `TopupForm.CardFields`: VGS Collect hosted fields (number, expiry, CVC,
 * optional cardholder name) laid out and validated like Stripe's
 * PaymentElement card form.
 *
 * What lives where:
 * - Inside the hosted iframes (VGS): the input text, placeholder, border,
 *   focus ring, invalid state. Styled through Collect `css`, which the SDK
 *   derives from the same `appearance` / `--solvapay-*` tokens that theme
 *   Stripe Elements (`buildCollectFieldCss`); `fieldCss` overrides last.
 * - In the host DOM (ours): labels, layout, the error line under each
 *   field, `data-state` on each wrapper. Style with the SDK stylesheet or
 *   plain CSS on `[data-solvapay-card-field]`.
 *
 * Validation mirrors Elements: fields validate as you type, an error shows
 * only once the field has been touched (blurred) and is invalid, and the
 * form reports complete only when every field is valid. Error text comes
 * from the SDK copy bundle keyed on VGS error codes, never from VGS.
 */

import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Appearance } from '@stripe/stripe-js'
import { Spinner } from '../components/Spinner'
import { useCopy } from '../hooks/useCopy'
import type { CaptureGrant, VaultInfo } from '../types'
import {
  captureCard,
  createCollectForm,
  isCollectFormComplete,
  type CapturedCard,
  type CollectFieldOptions,
  type CollectFieldState,
  type CollectForm,
  type CollectFormState,
} from './collect'
import { buildCollectFieldCss, mergeCollectCss, type CollectCss } from './collectAppearance'

export type CardCapture = (grant: CaptureGrant) => Promise<CapturedCard>

export type CardFieldName = 'cardholderName' | 'cardNumber' | 'expiry' | 'cvc'

export type CardFieldsProps = React.HTMLAttributes<HTMLElement> & {
  /** Show a cardholder name field above the card number. Default: false. */
  cardholderName?: boolean
  /** Render labels above the fields (Stripe PaymentElement style). Default: true. */
  labels?: boolean
  /** Show the detected card brand inside the number field. Default: true. */
  cardIcon?: boolean
  /** Placeholders for the hosted fields; defaults come from the copy bundle. */
  placeholders?: Partial<Record<CardFieldName, string>>
  /**
   * Style the text inside the hosted iframes. Collect CSS-in-JS: camelCase
   * properties plus `&:focus`, `&::placeholder`, `&.invalid.touched`,
   * `@font-face`, `@media`. Merged over the appearance-derived defaults, so
   * pass only what should differ.
   */
  fieldCss?: CollectCss
  /** Extra options for every hosted field (extra validations, inputMode, ...). */
  fieldOptions?: Omit<CollectFieldOptions, 'css' | 'placeholder' | 'name' | 'validations'>
}

export type VaultCardFieldsProps = CardFieldsProps & {
  vault: VaultInfo | null
  paymentIntentId: string | null
  /**
   * The same appearance that themes Stripe Elements on this host. `undefined`
   * gives Stripe's stock look; the form root usually passes the value it
   * derived from `--solvapay-*` tokens.
   */
  appearance?: Appearance
  /** Hand the form the capture function once the hosted fields are mounted; `null` on unmount. */
  onCapture: (capture: CardCapture | null) => void
  onComplete: (complete: boolean) => void
  /** Called with `true` while mounted so the owning form can set its element kind. */
  onActive?: (active: boolean) => void
}

/** VGS Collect error codes → copy keys. Unknown codes fall back to `invalid`. */
const ERROR_CODE_KEYS: Record<
  number,
  'required' | 'invalidNumber' | 'invalidExpiry' | 'invalidCvc'
> = {
  1001: 'required',
  1011: 'invalidNumber',
  1015: 'invalidExpiry',
  1017: 'invalidCvc',
}

const COLLECT_NAMES: Record<CardFieldName, string> = {
  cardholderName: 'cardholder',
  cardNumber: 'pan',
  expiry: 'exp-date',
  cvc: 'cvc',
}

type FieldUi = { state: 'empty' | 'focused' | 'valid' | 'invalid'; error: string | null }

function uiOf(field: CollectFieldState | undefined, copy: ReturnType<typeof useCopy>): FieldUi {
  if (!field) return { state: 'empty', error: null }
  const touchedInvalid =
    field.isTouched === true && field.isValid === false && field.isEmpty !== true
  const requiredMissing = field.isTouched === true && field.isEmpty === true
  let error: string | null = null
  if (touchedInvalid || requiredMissing) {
    const code = field.errors?.[0]?.code
    const key = requiredMissing
      ? 'required'
      : ((code !== undefined ? ERROR_CODE_KEYS[code] : undefined) ?? 'invalid')
    error = copy.cardFields.errors[key]
  }
  const state: FieldUi['state'] = field.isFocused
    ? 'focused'
    : error
      ? 'invalid'
      : field.isValid
        ? 'valid'
        : 'empty'
  return { state, error }
}

export const VaultCardFields = forwardRef<HTMLElement, VaultCardFieldsProps>(
  function VaultCardFields(
    {
      vault,
      paymentIntentId,
      appearance,
      onCapture,
      onComplete,
      onActive,
      cardholderName = false,
      labels = true,
      cardIcon = true,
      placeholders,
      fieldCss,
      fieldOptions,
      children: _children,
      ...rest
    },
    ref,
  ) {
    const copy = useCopy()
    const [containers, setContainers] = useState<
      Partial<Record<CardFieldName, HTMLDivElement | null>>
    >({})
    const [formState, setFormState] = useState<CollectFormState | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [mounted, setMounted] = useState(false)
    const formRef = useRef<CollectForm | null>(null)
    const callbacksRef = useRef({ onCapture, onComplete })
    callbacksRef.current = { onCapture, onComplete }
    const optionsRef = useRef({ placeholders, fieldCss, fieldOptions, cardIcon, appearance })
    optionsRef.current = { placeholders, fieldCss, fieldOptions, cardIcon, appearance }

    const active = !!vault && !!paymentIntentId
    const fieldsReady =
      active &&
      !!containers.cardNumber &&
      !!containers.expiry &&
      !!containers.cvc &&
      (!cardholderName || !!containers.cardholderName)

    useEffect(() => {
      if (!active || !onActive) return
      onActive(true)
      return () => onActive(false)
    }, [active, onActive])

    // Collect `css` is fixed at field creation; recompute only when the
    // theme actually changes so a re-theme remounts the fields.
    const css = useMemo(
      () => mergeCollectCss(buildCollectFieldCss(appearance), fieldCss),
      [appearance, fieldCss],
    )
    const cssKey = useMemo(() => JSON.stringify(css), [css])

    useEffect(() => {
      if (!fieldsReady || !vault || !paymentIntentId) return
      let cancelled = false
      let form: CollectForm | null = null
      const els = containers
      setLoadError(null)
      setMounted(false)
      setFormState(null)

      void (async () => {
        try {
          const created = await createCollectForm({
            vaultId: vault.tenantId,
            env: vault.environment,
            stateCallback: (state: CollectFormState) => {
              if (cancelled) return
              setFormState(state)
              callbacksRef.current.onComplete(isCollectFormComplete(state))
            },
          })
          if (cancelled) {
            created.unmount?.()
            return
          }
          form = created
          formRef.current = created
          const opts = optionsRef.current
          const base: CollectFieldOptions = {
            ...(opts.fieldOptions ?? {}),
            css,
            classes: {
              invalid: 'invalid',
              valid: 'valid',
              empty: 'empty',
              focused: 'focused',
              dirty: 'dirty',
              touched: 'touched',
            },
          }
          const placeholder = (name: CardFieldName) =>
            opts.placeholders?.[name] ?? copy.cardFields.placeholders[name]
          if (cardholderName && els.cardholderName) {
            created.cardholderNameField(els.cardholderName, {
              ...base,
              name: COLLECT_NAMES.cardholderName,
              placeholder: placeholder('cardholderName'),
              validations: ['required'],
              autoComplete: 'cc-name',
              ariaLabel: copy.cardFields.labels.cardholderName,
            })
          }
          created.cardNumberField(els.cardNumber as HTMLDivElement, {
            ...base,
            name: COLLECT_NAMES.cardNumber,
            placeholder: placeholder('cardNumber'),
            validations: ['required', 'validCardNumber'],
            autoComplete: 'cc-number',
            inputMode: 'numeric',
            ariaLabel: copy.cardFields.labels.cardNumber,
            showCardIcon: opts.cardIcon,
          })
          created.cardExpirationDateField(els.expiry as HTMLDivElement, {
            ...base,
            name: COLLECT_NAMES.expiry,
            placeholder: placeholder('expiry'),
            validations: ['required', 'validCardExpirationDate'],
            autoComplete: 'cc-exp',
            inputMode: 'numeric',
            ariaLabel: copy.cardFields.labels.expiry,
            yearLength: 2,
          })
          created.cardCVCField(els.cvc as HTMLDivElement, {
            ...base,
            name: COLLECT_NAMES.cvc,
            placeholder: placeholder('cvc'),
            validations: ['required', 'validCardSecurityCode'],
            autoComplete: 'cc-csc',
            inputMode: 'numeric',
            ariaLabel: copy.cardFields.labels.cvc,
          })
          callbacksRef.current.onCapture(grant => captureCard(created, grant))
          setMounted(true)
        } catch (err) {
          if (cancelled) return
          console.error('[CardFields] VGS Collect failed to load', err)
          setLoadError(copy.errors.cardFieldsMissing)
        }
      })()

      return () => {
        cancelled = true
        callbacksRef.current.onCapture(null)
        callbacksRef.current.onComplete(false)
        form?.unmount?.()
        formRef.current = null
      }
      // `containers` changes only when the wrapper elements mount/unmount;
      // `cssKey` stands in for `css` so equal themes do not remount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fieldsReady, vault?.tenantId, vault?.environment, paymentIntentId, cardholderName, cssKey])

    const setContainer = useCallback(
      (name: CardFieldName) => (el: HTMLDivElement | null) =>
        setContainers(c => (c[name] === el ? c : { ...c, [name]: el })),
      [],
    )
    const refs = useMemo(
      () => ({
        cardholderName: setContainer('cardholderName'),
        cardNumber: setContainer('cardNumber'),
        expiry: setContainer('expiry'),
        cvc: setContainer('cvc'),
      }),
      [setContainer],
    )

    if (!active) return null

    const field = (name: CardFieldName) => {
      const ui = uiOf(formState?.[COLLECT_NAMES[name]], copy)
      const errorId = `solvapay-card-field-${name}-error`
      return (
        <div data-solvapay-card-field={name} data-state={ui.state}>
          {labels ? (
            <span data-solvapay-card-field-label="">{copy.cardFields.labels[name]}</span>
          ) : null}
          <div
            data-solvapay-card-field-input=""
            ref={refs[name]}
            aria-describedby={ui.error ? errorId : undefined}
          />
          {ui.error ? (
            <p id={errorId} role="alert" data-solvapay-card-field-error="">
              {ui.error}
            </p>
          ) : null}
        </div>
      )
    }

    return (
      <section
        ref={ref}
        data-solvapay-card-fields=""
        data-state={loadError ? 'error' : mounted ? 'ready' : 'loading'}
        {...rest}
      >
        {cardholderName ? field('cardholderName') : null}
        {field('cardNumber')}
        <div data-solvapay-card-field-row="">
          {field('expiry')}
          {field('cvc')}
        </div>
        {!mounted && !loadError ? (
          <output data-solvapay-payment-form-loading="">
            <Spinner size="sm" />
          </output>
        ) : null}
        {loadError ? (
          <p role="alert" data-solvapay-payment-form-error="">
            {loadError}
          </p>
        ) : null}
      </section>
    )
  },
)
