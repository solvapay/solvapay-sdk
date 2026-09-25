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

import React, {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Slot } from './slot'
import { setRef } from './composeRefs'
import { CardFieldsProvider, useCardFields } from '../components/CardFieldsContext'
import { useCaptureSession } from '../hooks/useCaptureSession'
import { SolvaPayContext } from '../SolvaPayProvider'
import { UnsupportedTransportMethodError } from '../transport'
import { CaptureForm, type MountFieldOptions } from '../vault/captureForm'
import { assertIntegrityForLive } from '../vault/loadVaultScript'
import {
  CaptureError,
  emptyCaptureState,
  type CaptureFieldName,
  type CaptureFieldOptions,
  type CaptureSession,
  type CaptureState,
  type CapturedInstrument,
  type SavedInstrument,
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
  const { session, error: sessionError, refresh } = useCaptureSession({ productRef, planRef })
  const solvaPay = useContext(SolvaPayContext)

  const [state, setState] = useState<CaptureState>(emptyCaptureState)
  const [error, setError] = useState<CaptureError | null>(null)
  const [formReady, setFormReady] = useState(false)
  const [saving, setSaving] = useState(false)

  const formRef = useRef<CaptureForm | null>(null)

  // Every field whose container is currently in the DOM, kept for the life of
  // the surface rather than drained on first mount.
  //
  // It used to be a one-shot `pending` map, cleared once the script resolved.
  // That made a new session fatal: the form effect tears the old form down and
  // builds a new one, but the field slots' ref callbacks do not fire again
  // (their DOM nodes never changed), so nothing re-mounted the iframes. The
  // surface went permanently blank while still reporting ready and complete —
  // after every successful save, and again thirty seconds before expiry while
  // the cardholder was still typing.
  const mounted = useRef(new Map<CaptureFieldName, MountFieldOptions>())

  // Callbacks live in refs so nothing below depends on their identity. A host
  // writes `onStateChange={s => ...}` inline, which is a new function every
  // render; if the form-creation effect depended on it, the form would be torn
  // down and rebuilt on every render.
  const onEnterRef = useRef(onEnter)
  const onStateChangeRef = useRef(onStateChange)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onEnterRef.current = onEnter
    onStateChangeRef.current = onStateChange
    onErrorRef.current = onError
  })

  const raise = useCallback((err: CaptureError) => {
    setError(err)
    onErrorRef.current?.(err)
  }, [])

  // The grant, by reference. A replacement swaps the token under the form
  // rather than rebuilding it, so nothing the cardholder has typed is lost when
  // the grant is renewed.
  const sessionRef = useRef(session)
  useEffect(() => {
    sessionRef.current = session
  })

  // The form is bound to a tenant and an environment, not to a grant.
  const tenantId = session?.tenantId
  const environment = session?.environment

  // The script config by value, not by object identity. `script={{ version }}`
  // written inline is the obvious way to use this component and produces a new
  // object every render, so depending on the object is depending on the caller
  // never doing the obvious thing.
  const { version: scriptVersion, integrity: scriptIntegrity, host: scriptHost } = script

  useEffect(() => {
    if (sessionError) raise(sessionError)
  }, [sessionError, raise])

  // One form per session. A new session means a new form, never a reused one.
  useEffect(() => {
    if (!tenantId || !environment) return
    let cancelled = false

    // The check this function exists for, actually wired in. It was exported
    // and called from nowhere, so a Live surface with no integrity hash loaded
    // and worked, silently, which is the one case it was written to prevent.
    try {
      assertIntegrityForLive(
        {
          version: scriptVersion,
          ...(scriptIntegrity ? { integrity: scriptIntegrity } : {}),
          ...(scriptHost ? { host: scriptHost } : {}),
        },
        environment,
      )
    } catch (err) {
      raise(
        err instanceof CaptureError
          ? err
          : new CaptureError('script_load_failed', 'The capture surface is misconfigured.'),
      )
      return
    }

    CaptureForm.create({
      getSession: () => sessionRef.current as CaptureSession,
      script: {
        version: scriptVersion,
        ...(scriptIntegrity ? { integrity: scriptIntegrity } : {}),
        ...(scriptHost ? { host: scriptHost } : {}),
      },
      onStateChange: next => {
        if (cancelled) return
        setState(next)
        onStateChangeRef.current?.(next)
      },
      onEnter: () => onEnterRef.current?.(),
    })
      .then(form => {
        if (cancelled) {
          form.destroy()
          return
        }
        formRef.current = form
        // Mount every field we know about: the ones whose containers appeared
        // before the script resolved, and, when this is a replacement form,
        // the ones that were already mounted on its predecessor.
        for (const mount of mounted.current.values()) {
          form.mountField(mount)
        }
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
      // The fields are gone with the form, so stop claiming they are valid.
      // Leaving stale state behind is how the surface came to report ready and
      // complete over three empty boxes.
      setState(emptyCaptureState())
      formRef.current?.destroy()
      formRef.current = null
    }
    // Values only, never objects or functions, and deliberately NOT the whole
    // session: a renewed grant is a new token, not a new form.
  }, [tenantId, environment, scriptVersion, scriptIntegrity, scriptHost, raise])

  const registerField = useCallback(
    (name: CaptureFieldName, element: HTMLElement | null, options?: CaptureFieldOptions) => {
      if (!element) {
        formRef.current?.unmountField(name)
        mounted.current.delete(name)
        return
      }
      const mount = { name, selector: `#${CSS.escape(element.id)}`, ...options }
      mounted.current.set(name, mount)
      formRef.current?.mountField(mount)
    },
    [],
  )

  const capture = useCallback(async (): Promise<CapturedInstrument> => {
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

  const inFlight = useRef(false)

  const save = useCallback(
    async (options: { setAsDefault?: boolean } = {}): Promise<SavedInstrument> => {
      // Claimed synchronously, before anything awaits. `saving` used to be set
      // only after the vault round-trip, so a host doing the documented
      // `disabled={!complete || saving}` still had a live button for the whole
      // of it: a double click put two cards in the vault and orphaned one.
      if (inFlight.current) {
        throw new CaptureError('vault_error', 'A card is already being saved.')
      }
      inFlight.current = true
      setSaving(true)
      // Read the grant id before the card goes anywhere. Capturing first and
      // then discovering there is nothing to report the result against would
      // leave a card in the vault that we hold no reference to, which is worse
      // than not capturing at all.
      try {
        const captureSessionId = sessionRef.current?.captureSessionId
        if (!captureSessionId) {
          const err = new CaptureError('session_expired', 'The capture session is no longer valid.')
          raise(err)
          throw err
        }

        const create = solvaPay?._config?.transport?.createInstrument
        if (!create) {
          throw new UnsupportedTransportMethodError('createInstrument')
        }

        const instrument = await capture()

        const saved = await create({
          handle: instrument.handle,
          captureSessionId,
          descriptors: instrument.descriptors,
          ...(options.setAsDefault === undefined ? {} : { setAsDefault: options.setAsDefault }),
        })
        // The grant is spent now, server side. Mint the next one so the surface
        // is usable again rather than failing on the second card with an error
        // about a session the cardholder never knew existed. The form is not
        // rebuilt for it: only the token changes.
        void refresh()
        // A save that worked clears whatever failed before it. Without this a
        // decline stayed on screen next to a card that had just been saved.
        setError(null)
        return saved
      } catch (err) {
        const captureError =
          err instanceof CaptureError
            ? err
            : new CaptureError(
                'vault_error',
                err instanceof Error ? err.message : 'The card was not saved.',
              )
        raise(captureError)
        throw captureError
      } finally {
        inFlight.current = false
        setSaving(false)
      }
    },
    [solvaPay, capture, raise, refresh],
  )

  const value = useMemo(
    () => ({
      session,
      state,
      ready: formReady && state.ready,
      complete: state.complete,
      error,
      registerField,
      capture,
      saving,
      save,
    }),
    [session, state, formReady, error, registerField, capture, saving, save],
  )

  const Comp = asChild ? Slot : 'section'
  return (
    <CardFieldsProvider value={value}>
      <Comp
        ref={forwardedRef}
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

    // Captured once, on the first render, and never reassigned. The vault reads
    // these when it mounts the iframe and ignores them afterwards, so freezing
    // them here matches what actually happens. Writing to the ref on every
    // render would also be a render-phase side effect, which React does not
    // promise to run exactly once.
    const optionsRef = useRef<CaptureFieldOptions | null>(null)
    if (optionsRef.current === null) {
      optionsRef.current = {
        ...(placeholder ? { placeholder } : {}),
        ...(fieldStyle ? { style: fieldStyle } : {}),
        ...(ariaLabel ? { ariaLabel } : {}),
        ...(autoComplete ? { autoComplete } : {}),
      }
    }

    // The context is read through a ref so that nothing below depends on its
    // identity. `ctx` is a fresh object on every state publish, and every
    // publish happens while the cardholder is typing.
    const ctxRef = useRef(ctx)
    useEffect(() => {
      ctxRef.current = ctx
    })

    // This ref callback MUST be stable.
    //
    // React calls a ref callback again whenever its identity changes: the old
    // one with null, the new one with the node. With `[ctx]` as the dependency
    // that happened on every state publish, so each keystroke unmounted and
    // remounted the vault iframe — losing what had been typed into it, and, via
    // the state change each unmount publishes, spinning: publish, new ctx, new
    // callback, unmount, publish. It runs to an out-of-memory crash under test
    // and would have been a dead payment form in a browser.
    const attach = useCallback((node: HTMLDivElement | null) => {
      elementRef.current = node
      ctxRef.current.registerField(name, node, optionsRef.current ?? undefined)
    }, [])
    const attachRef = useRef(attach)
    useEffect(() => {
      attachRef.current = attach
    })

    // Unmount once, on teardown, and only then.
    useEffect(() => () => ctxRef.current.registerField(name, null), [])

    // The ref React actually receives is the COMPOSED one, so composing inline
    // undoes the stability of `attach`: `composeRefs` returns a fresh closure
    // on every call, React sees a new ref callback, and detaches then
    // reattaches. Each detach unmounts the vault field, which publishes state,
    // which renders, which composes a new ref. Memoising is what actually
    // stops it.
    // `forwardedRef` is in a ref too. A host writing the ordinary
    // `<CardFields.Number ref={n => (nodes.current.number = n)} />` passes a new
    // function every render; with it in the dependency array the composed ref
    // churned, React detached and reattached, and the publish-remount-publish
    // loop came straight back through the one prop the memo cannot stabilise.
    const forwardedRefRef = useRef(forwardedRef)
    useEffect(() => {
      forwardedRefRef.current = forwardedRef
    })

    const composedRef = useCallback((node: HTMLDivElement | null) => {
      setRef(forwardedRefRef.current, node)
      attachRef.current(node)
    }, [])

    const field = ctx.state.fields[name]
    const Comp = asChild ? Slot : 'div'
    return (
      <Comp
        id={id}
        ref={composedRef}
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
  // Optional, not asserted. A misspelled or unmounted field name must render
  // nothing, not throw: an exception here unmounts the whole payment form, and
  // the one job of this component is to report a problem.
  const state = ctx.state.fields[field]
  if (!state?.touched || state.valid || !state.message) return null

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
