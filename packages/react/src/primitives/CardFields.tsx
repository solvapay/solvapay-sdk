'use client'

/**
 * Vault capture slots.
 *
 * The second capture surface alongside the PSP element. Each sensitive input
 * is a cross-origin iframe served by the vault and mounted into a container we
 * own, so we keep the layout, the labels, the errors and the submit control
 * while never touching the card number.
 *
 * Every leaf takes `asChild`, emits `data-solvapay-card-fields-*` and, where it
 * has one, a `data-state`, matching the conventions of the rest of the tree.
 */

import React, { forwardRef, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Slot } from './slot'
import { composeRefs } from './composeRefs'
import { CardFieldsProvider, useCardFields } from '../components/CardFieldsContext'
import { useCaptureSession } from '../hooks/useCaptureSession'
import { CaptureForm, type MountFieldOptions } from '../vault/captureForm'
import {
  CaptureError,
  emptyCaptureState,
  type CaptureFieldName,
  type CaptureFieldOptions,
  type CaptureState,
  type CapturedCredential,
} from '../vault/types'
import type { VaultScriptConfig } from '../vault/loadVaultScript'

/* ------------------------------------------------------------------ Root */

export interface CardFieldsRootProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onError'> {
  asChild?: boolean
  /** Pinned vault script version and its integrity hash. */
  script: VaultScriptConfig
  productRef?: string
  planRef?: string
  /** Submitted with the card so the vault can store a cardholder name. */
  cardholder?: { name?: string; email?: string }
  /** Fired when the cardholder presses Enter in any field. */
  onEnter?: () => void
  onStateChange?: (state: CaptureState) => void
  onError?: (error: CaptureError) => void
  children?: React.ReactNode
}

const Root = forwardRef<HTMLElement, CardFieldsRootProps>(function CardFieldsRoot(
  {
    asChild,
    script,
    productRef,
    planRef,
    cardholder,
    onEnter,
    onStateChange,
    onError,
    children,
    ...rest
  },
  forwardedRef,
) {
  const { session, error: sessionError } = useCaptureSession({ productRef, planRef })

  const [state, setState] = useState<CaptureState>(emptyCaptureState)
  const [error, setError] = useState<CaptureError | null>(null)
  const [formReady, setFormReady] = useState(false)

  const formRef = useRef<CaptureForm | null>(null)
  const pending = useRef(new Map<CaptureFieldName, MountFieldOptions>())
  const onEnterRef = useRef(onEnter)
  onEnterRef.current = onEnter

  const raise = useCallback(
    (err: CaptureError) => {
      setError(err)
      onError?.(err)
    },
    [onError],
  )

  useEffect(() => {
    if (sessionError) raise(sessionError)
  }, [sessionError, raise])

  // One form per session. A new session means a new form, never a reused one.
  useEffect(() => {
    if (!session) return
    let cancelled = false

    CaptureForm.create({
      session,
      script,
      onStateChange: next => {
        if (cancelled) return
        setState(next)
        onStateChange?.(next)
      },
      onEnter: () => onEnterRef.current?.(),
    })
      .then(form => {
        if (cancelled) {
          form.destroy()
          return
        }
        formRef.current = form
        // Mount anything whose container appeared before the script resolved.
        for (const mount of pending.current.values()) {
          form.mountField(mount)
        }
        pending.current.clear()
        setFormReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        raise(
          err instanceof CaptureError
            ? err
            : new CaptureError('script_load_failed', 'The capture surface failed to start.'),
        )
      })

    return () => {
      cancelled = true
      setFormReady(false)
      formRef.current?.destroy()
      formRef.current = null
    }
    // `script` is a config object; consumers should pass a stable reference.
  }, [session, script, onStateChange, raise])

  const registerField = useCallback(
    (name: CaptureFieldName, element: HTMLElement | null, options?: CaptureFieldOptions) => {
      if (!element) {
        formRef.current?.unmountField(name)
        pending.current.delete(name)
        return
      }
      const mount = { name, selector: `#${CSS.escape(element.id)}`, ...options }
      if (formRef.current) formRef.current.mountField(mount)
      else pending.current.set(name, mount)
    },
    [],
  )

  const capture = useCallback(async (): Promise<CapturedCredential> => {
    const form = formRef.current
    if (!form) {
      throw new CaptureError('vault_error', 'The capture surface is not ready yet.')
    }
    try {
      return await form.submit(cardholder)
    } catch (err) {
      const captureError =
        err instanceof CaptureError
          ? err
          : new CaptureError('vault_error', 'The card was not saved.')
      raise(captureError)
      throw captureError
    }
  }, [cardholder, raise])

  const value = useMemo(
    () => ({
      session,
      state,
      ready: formReady && state.ready,
      complete: state.complete,
      error,
      registerField,
      capture,
    }),
    [session, state, formReady, error, registerField, capture],
  )

  const Comp = asChild ? Slot : 'section'
  return (
    <CardFieldsProvider value={value}>
      <Comp
        ref={composeRefs(forwardedRef)}
        data-solvapay-card-fields=""
        data-state={error ? 'error' : value.ready ? 'ready' : 'loading'}
        {...rest}
      >
        {children}
      </Comp>
    </CardFieldsProvider>
  )
})

/* ---------------------------------------------------------------- Fields */

interface FieldSlotProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>,
    Omit<CaptureFieldOptions, 'style'> {
  asChild?: boolean
  /**
   * Styling for the text inside the vault's iframe.
   *
   * Separate from `style`, which styles the container we own. Values must be
   * literals: CSS custom properties from this page do not resolve inside the
   * frame, and media queries there match the frame's width, not the viewport.
   */
  fieldStyle?: CaptureFieldOptions['style']
}

/**
 * Builds one container slot.
 *
 * The container is ours and stays empty: the vault mounts its iframe inside
 * it. That is why these take no children and why the id has to be stable.
 */
function createFieldSlot(name: CaptureFieldName, attribute: string) {
  const Component = forwardRef<HTMLDivElement, FieldSlotProps>(function CardField(
    { asChild, placeholder, fieldStyle, ariaLabel, autoComplete, ...rest },
    forwardedRef,
  ) {
    const ctx = useCardFields()
    const generatedId = useId().replace(/:/g, '')
    const id = `solvapay-cf-${name}-${generatedId}`
    const elementRef = useRef<HTMLDivElement | null>(null)

    const optionsRef = useRef<CaptureFieldOptions>({})
    optionsRef.current = {
      ...(placeholder ? { placeholder } : {}),
      ...(fieldStyle ? { style: fieldStyle } : {}),
      ...(ariaLabel ? { ariaLabel } : {}),
      ...(autoComplete ? { autoComplete } : {}),
    }

    const attach = useCallback(
      (node: HTMLDivElement | null) => {
        elementRef.current = node
        ctx.registerField(name, node, optionsRef.current)
      },
      [ctx],
    )

    // Unmount once, on teardown. Depending on `ctx` here would remount the
    // iframe on every state change, which loses whatever the cardholder typed.
    const unregisterRef = useRef<() => void>(() => {})
    unregisterRef.current = () => ctx.registerField(name, null)
    useEffect(() => () => unregisterRef.current(), [])

    const field = ctx.state.fields[name]
    const Comp = asChild ? Slot : 'div'
    return (
      <Comp
        id={id}
        ref={composeRefs(forwardedRef, attach)}
        data-state={
          field.mounted ? (field.valid ? 'valid' : field.touched ? 'invalid' : 'idle') : 'loading'
        }
        {...{ [attribute]: '' }}
        {...rest}
      />
    )
  })
  Component.displayName = `CardFields.${name}`
  return Component
}

const Number_ = createFieldSlot('cardNumber', 'data-solvapay-card-fields-number')
const Expiry = createFieldSlot('expiry', 'data-solvapay-card-fields-expiry')
const Cvc = createFieldSlot('cvc', 'data-solvapay-card-fields-cvc')
const Cardholder = createFieldSlot('cardholderName', 'data-solvapay-card-fields-cardholder')

/* ------------------------------------------------------- Supporting slots */

export interface FieldErrorProps extends React.HTMLAttributes<HTMLParagraphElement> {
  asChild?: boolean
  field: CaptureFieldName
}

/** Renders a field's validation message, or nothing until it has been touched. */
const FieldError = forwardRef<HTMLParagraphElement, FieldErrorProps>(function CardFieldsFieldError(
  { asChild, field, children, ...rest },
  forwardedRef,
) {
  const ctx = useCardFields()
  const state = ctx.state.fields[field]
  if (!state.touched || state.valid || !state.message) return null

  const Comp = asChild ? Slot : 'p'
  return (
    <Comp
      ref={forwardedRef}
      role="alert"
      aria-live="polite"
      data-solvapay-card-fields-error=""
      {...rest}
    >
      {children ?? state.message}
    </Comp>
  )
})

export interface CardFieldsLoadingProps extends React.HTMLAttributes<HTMLOutputElement> {
  asChild?: boolean
}

/** Shown until every required field has mounted. Renders nothing after that. */
const Loading = forwardRef<HTMLOutputElement, CardFieldsLoadingProps>(function CardFieldsLoading(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useCardFields()
  if (ctx.ready) return null

  const Comp = asChild ? Slot : 'output'
  return (
    <Comp ref={forwardedRef} aria-live="polite" data-solvapay-card-fields-loading="" {...rest}>
      {children}
    </Comp>
  )
})

export interface BrandIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  asChild?: boolean
  /** Rendered when no brand has been detected yet. */
  fallback?: React.ReactNode
}

/**
 * Exposes the detected brand as `data-brand` so a consumer can style or swap
 * an icon without reading context themselves.
 */
const BrandIcon = forwardRef<HTMLSpanElement, BrandIconProps>(function CardFieldsBrandIcon(
  { asChild, fallback, children, ...rest },
  forwardedRef,
) {
  const ctx = useCardFields()
  const brand = ctx.state.brand
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp
      ref={forwardedRef}
      data-solvapay-card-fields-brand=""
      data-brand={brand ?? 'unknown'}
      aria-hidden="true"
      {...rest}
    >
      {brand ? children : (fallback ?? children)}
    </Comp>
  )
})

/* -------------------------------------------------------------- Namespace */

export const CardFields = {
  Root,
  Cardholder,
  Number: Number_,
  Expiry,
  Cvc,
  FieldError,
  Loading,
  BrandIcon,
} as const

export const CardFieldsRoot = Root
export const CardFieldsCardholder = Cardholder
export const CardFieldsNumber = Number_
export const CardFieldsExpiry = Expiry
export const CardFieldsCvc = Cvc
export const CardFieldsFieldError = FieldError
export const CardFieldsLoading = Loading
export const CardFieldsBrandIcon = BrandIcon
