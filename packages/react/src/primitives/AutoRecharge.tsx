'use client'

/**
 * AutoRecharge compound primitive.
 *
 * Headless building blocks for automatic credit top-up configuration.
 * State comes from `useAutoRecharge` + local form state via `Root`.
 */

import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { AutoRechargeConfig, SaveAutoRechargeResponse } from '@solvapay/server'
import { Slot } from './slot'
import { composeEventHandlers } from './composeEventHandlers'
import { useAppearance } from './useAppearance'
import { useAutoRecharge } from '../hooks/useAutoRecharge'
import { useBalance } from '../hooks/useBalance'
import { useCopy } from '../hooks/useCopy'
import { waitForAutoRechargeActivation } from './autoRechargeActivation'
import { useTransport } from '../hooks/useTransport'
import { VaultCardFields, type CardCapture } from '../vault/CardFields'
import { CardCaptureError } from '../vault/collect'
import type { CaptureGrant } from '../types'
import {
  buildCardSetupReturnUrl,
  readCardSetupReturn,
  stripCardSetupReturnParams,
  withoutCardSetupReturnParams,
} from './cardSetupReturn'
import { interpolate } from '../i18n/interpolate'
import { Spinner } from '../components/Spinner'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import {
  buildSummaryLine,
  configToForm,
  flipUnitValue,
  createDefaultAutoRechargeForm,
  validateAutoRechargeForm,
  isMonthlySpendCapReached,
  effectiveMonthlySpend,
  type AmountInputUnit,
  type AutoRechargeFormState,
  type AutoRechargeInputPayload,
} from '../helpers/auto-recharge-form'
import { estimateCredits, estimateCurrencyMajorFromCredits } from '../utils/credit-estimation'
import { formatPrice, getMinorUnitsPerMajor } from '../utils/format'

type AutoRechargeDataState = 'loading' | 'idle' | 'saving' | 'disabling' | 'setup' | 'error'

type AutoRechargeContextValue = {
  form: AutoRechargeFormState
  updateForm: (patch: Partial<AutoRechargeFormState>) => void
  resetForm: () => void
  validationError: string | null
  currency: string
  config: AutoRechargeConfig | null
  loading: boolean
  saving: boolean
  disabling: boolean
  error: Error | null
  statusMessage: string | null
  setup: SaveAutoRechargeResponse | null
  dataState: AutoRechargeDataState
  creditsPerMinorUnit: number | null
  displayExchangeRate: number | null
  canToggleUnits: boolean
  isApproximate: boolean
  summaryLine: string | null
  savedSummaryLine: string | null
  deferCardSetup: boolean
  fixedTopupHint: string | null
  open: boolean
  setOpen: (next: boolean) => void
  titleId: string
  registerTriggerRef: (node: HTMLButtonElement | null) => void
  focusTrigger: () => void
  save: () => Promise<void>
  disable: () => Promise<void>
  completeSetup: () => Promise<void>
  pendingSetup: () => Promise<void>
  flipUnit: (
    valueKey: 'thresholdAmountMajor' | 'topupAmountMajor',
    unitKey: 'thresholdUnit' | 'topupUnit',
    baseValueKey: 'thresholdBaseValue' | 'topupBaseValue',
    baseUnitKey: 'thresholdBaseUnit' | 'topupBaseUnit',
    currentUnit: AmountInputUnit,
  ) => void
}

const AutoRechargeContext = createContext<AutoRechargeContextValue | null>(null)

function useAutoRechargeCtx(part: string): AutoRechargeContextValue {
  const ctx = useContext(AutoRechargeContext)
  if (!ctx) {
    throw new Error(`AutoRecharge.${part} must be rendered inside <AutoRecharge.Root>.`)
  }
  return ctx
}

function getCurrencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0)
    const sym = parts.find(p => p.type === 'currency')
    return sym?.value ?? currency.toUpperCase()
  } catch {
    return currency.toUpperCase()
  }
}

type RootProps = {
  currency?: string
  defaultThresholdAmountMajor?: number
  defaultTopupAmountMajor?: number
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  onSetupRequired?: (result: SaveAutoRechargeResponse) => void | Promise<void>
  onSaved?: (result: SaveAutoRechargeResponse) => void | Promise<void>
  onDisabled?: () => void | Promise<void>
  deferCardSetup?: boolean
  onPendingConfig?: (payload: AutoRechargeInputPayload) => void | Promise<void>
  asChild?: boolean
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'children'>

const Root = forwardRef<HTMLElement, RootProps>(function AutoRechargeRoot(
  {
    currency = 'USD',
    defaultThresholdAmountMajor,
    defaultTopupAmountMajor,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    onSetupRequired,
    onSaved,
    onDisabled,
    deferCardSetup = false,
    onPendingConfig,
    asChild,
    children,
    className,
    ...rest
  },
  forwardedRef,
) {
  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('AutoRecharge')

  const autoRecharge = useAutoRecharge()
  const { creditsPerMinorUnit, displayExchangeRate } = useBalance()
  const copy = useCopy()
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const defaultTopup = defaultTopupAmountMajor ?? defaultThresholdAmountMajor ?? undefined

  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(next)
      }
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  const registerTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node
  }, [])

  const focusTrigger = useCallback(() => {
    triggerRef.current?.focus()
  }, [])

  const [form, setForm] = useState<AutoRechargeFormState>(() =>
    autoRecharge.config
      ? configToForm(autoRecharge.config, currency)
      : createDefaultAutoRechargeForm(currency, defaultTopup),
  )
  const [validationError, setValidationError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [setup, setSetup] = useState<SaveAutoRechargeResponse | null>(null)

  // Latest server config, read inside async flows (activation polling) without
  // re-subscribing the callback to every config change.
  const latestConfigRef = useRef(autoRecharge.config)
  useEffect(() => {
    latestConfigRef.current = autoRecharge.config
  }, [autoRecharge.config])

  useEffect(() => {
    if (autoRecharge.config) {
      // Mirror server config into editable local form state when it changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional external-to-local sync
      setForm(configToForm(autoRecharge.config, currency))
    }
  }, [autoRecharge.config, currency])

  const canToggleUnits = creditsPerMinorUnit != null && creditsPerMinorUnit > 0
  const rate = displayExchangeRate ?? 1
  const isApproximate = rate !== 1

  const emitValidation = useCallback(
    (next: AutoRechargeFormState) => {
      const result = validateAutoRechargeForm(
        next,
        currency,
        { creditsPerMinorUnit, displayExchangeRate },
        copy.autoRecharge,
      )
      if (!result.ok) {
        setValidationError(result.error)
        return null
      }
      setValidationError(null)
      return result.payload
    },
    [currency, creditsPerMinorUnit, displayExchangeRate, copy.autoRecharge],
  )

  const updateForm = useCallback(
    (patch: Partial<AutoRechargeFormState>) => {
      setForm(prev => {
        const next = { ...prev, ...patch }
        emitValidation(next)
        return next
      })
    },
    [emitValidation],
  )

  const resetForm = useCallback(() => {
    if (autoRecharge.config) {
      setForm(configToForm(autoRecharge.config, currency))
    } else {
      setForm(createDefaultAutoRechargeForm(currency, defaultTopup))
    }
    setValidationError(null)
  }, [autoRecharge.config, currency, defaultTopup])

  const flipUnit = useCallback(
    (
      valueKey: 'thresholdAmountMajor' | 'topupAmountMajor',
      unitKey: 'thresholdUnit' | 'topupUnit',
      baseValueKey: 'thresholdBaseValue' | 'topupBaseValue',
      baseUnitKey: 'thresholdBaseUnit' | 'topupBaseUnit',
      currentUnit: AmountInputUnit,
    ) => {
      const nextUnit: AmountInputUnit = currentUnit === 'currency' ? 'credits' : 'currency'
      setForm(prev => {
        const anchor = { value: prev[baseValueKey], unit: prev[baseUnitKey] }
        const flipped = flipUnitValue(
          anchor,
          nextUnit,
          currency,
          creditsPerMinorUnit,
          displayExchangeRate,
        )
        const next = {
          ...prev,
          [unitKey]: flipped.unit,
          [valueKey]: flipped.value,
        } as AutoRechargeFormState
        emitValidation(next)
        return next
      })
    },
    [currency, creditsPerMinorUnit, displayExchangeRate, emitValidation],
  )

  const fixedTopupHint = useMemo(() => {
    const parsed = Number(form.topupAmountMajor)
    if (!Number.isFinite(parsed) || parsed <= 0) return null

    if (form.topupUnit === 'currency') {
      const credits = estimateCredits(parsed, currency, creditsPerMinorUnit, displayExchangeRate)
      if (credits == null) return null
      return { credits, approximate: isApproximate }
    }

    const major = estimateCurrencyMajorFromCredits(
      parsed,
      currency,
      creditsPerMinorUnit,
      displayExchangeRate,
    )
    if (major == null) return null
    return { major, approximate: isApproximate }
  }, [
    form.topupAmountMajor,
    form.topupUnit,
    currency,
    creditsPerMinorUnit,
    displayExchangeRate,
    isApproximate,
  ])

  const summaryLine = useMemo(() => buildSummaryLine(form, currency), [form, currency])

  const savedSummaryLine = useMemo(() => {
    if (!autoRecharge.config?.enabled) return null
    return buildSummaryLine(
      configToForm(autoRecharge.config, currency),
      currency,
    )
  }, [autoRecharge.config, currency])

  const save = useCallback(async () => {
    const payload = emitValidation(form)
    if (!payload) return

    const saveInput = deferCardSetup ? { ...payload, deferSetupIntent: true } : payload

    const result = await autoRecharge.save(saveInput)
    // No reusable card on file: collect one through `CardSetup` (vault,
    // customer session). A deferred save arms the card on the top-up instead.
    if (!deferCardSetup && result.requiresPaymentMethod === true) {
      setSetup(result)
      setStatusMessage(copy.autoRecharge.setupRequiredMessage)
      await onSetupRequired?.(result)
      return
    }
    setSetup(null)
    if (deferCardSetup) {
      await onPendingConfig?.(payload)
    }
    setStatusMessage(
      payload.enabled ? copy.autoRecharge.savedMessage : copy.autoRecharge.disabledMessage,
    )
    setOpen(false)
    await onSaved?.(result)
  }, [
    autoRecharge,
    copy.autoRecharge,
    deferCardSetup,
    emitValidation,
    form,
    onPendingConfig,
    onSaved,
    onSetupRequired,
    setOpen,
  ])

  const disable = useCallback(async () => {
    await autoRecharge.disable()
    setStatusMessage(copy.autoRecharge.disabledMessage)
    setSetup(null)
    await onDisabled?.()
  }, [autoRecharge, copy.autoRecharge, onDisabled])

  const completeSetup = useCallback(async () => {
    // Saving the card does not flip the config synchronously; the server
    // marks it `active` once the saved card is attached. Poll until the
    // server confirms before claiming "saved", otherwise a race shows
    // success over a still-`pending_setup` config.
    const activated = await waitForAutoRechargeActivation({
      refresh: autoRecharge.refresh,
      getStatus: () => latestConfigRef.current?.status,
    })
    setSetup(null)
    if (!form.enabled) return
    if (activated) {
      setStatusMessage(copy.autoRecharge.savedMessage)
      setOpen(false)
    } else {
      setStatusMessage(copy.autoRecharge.setupAwaitingConfirmation)
    }
  }, [autoRecharge, copy.autoRecharge, form.enabled, setOpen])

  /** Card save answered `processing`: tell the payer and re-read the config. */
  const pendingSetup = useCallback(async () => {
    setStatusMessage(copy.autoRecharge.setupAwaitingConfirmation)
    await autoRecharge.refresh(true)
  }, [autoRecharge, copy.autoRecharge])

  // 3DS return for card setup: `CardSetup` tagged `returnUrl` with the
  // session and card id. Post the same card again to finish the pending
  // setup, then re-read the config.
  const transport = useTransport()
  const setupReturnStarted = useRef(false)
  useEffect(() => {
    if (setupReturnStarted.current || typeof window === 'undefined') return
    const resume = readCardSetupReturn(window.location.search)
    if (!resume) return
    setupReturnStarted.current = true
    const returnUrl = withoutCardSetupReturnParams(window.location.href)
    stripCardSetupReturnParams()
    if (!transport.saveCard) {
      setStatusMessage(copy.autoRecharge.setupAuthFailed)
      return
    }
    const saveCard = transport.saveCard
    void (async () => {
      try {
        const result = await saveCard({
          sessionId: resume.sessionId,
          cardId: resume.cardId,
          returnUrl: buildCardSetupReturnUrl(returnUrl, resume),
        })
        if (result.status === 'succeeded') {
          // The form may not reflect the config yet on a fresh page load, so
          // report the activation outcome directly.
          const activated = await waitForAutoRechargeActivation({
            refresh: autoRecharge.refresh,
            getStatus: () => latestConfigRef.current?.status,
          })
          setStatusMessage(
            activated ? copy.autoRecharge.savedMessage : copy.autoRecharge.setupAwaitingConfirmation,
          )
        } else if (result.status === 'processing') {
          await pendingSetup()
        } else if (result.status === 'requires_action' && result.redirectUrl) {
          window.location.assign(result.redirectUrl)
        } else {
          setStatusMessage(copy.autoRecharge.setupAuthFailed)
        }
      } catch {
        setStatusMessage(copy.autoRecharge.setupAuthFailed)
      }
    })()
  }, [transport, autoRecharge, copy.autoRecharge, pendingSetup])

  const dataState: AutoRechargeDataState = setup
    ? 'setup'
    : autoRecharge.error
      ? 'error'
      : autoRecharge.loading
        ? 'loading'
        : autoRecharge.saving
          ? 'saving'
          : autoRecharge.disabling
            ? 'disabling'
            : 'idle'

  const ctx = useMemo<AutoRechargeContextValue>(
    () => ({
      form,
      updateForm,
      resetForm,
      validationError,
      currency,
      config: autoRecharge.config,
      loading: autoRecharge.loading,
      saving: autoRecharge.saving,
      disabling: autoRecharge.disabling,
      error: autoRecharge.error,
      statusMessage,
      setup,
      dataState,
      creditsPerMinorUnit,
      displayExchangeRate,
      canToggleUnits,
      isApproximate,
      summaryLine,
      savedSummaryLine,
      deferCardSetup,
      fixedTopupHint:
        fixedTopupHint && 'credits' in fixedTopupHint
          ? String(fixedTopupHint.credits)
          : fixedTopupHint && 'major' in fixedTopupHint
            ? formatPrice(
                Math.round(fixedTopupHint.major * getMinorUnitsPerMajor(currency)),
                currency,
                { free: '' },
              )
            : null,
      open,
      setOpen,
      titleId,
      registerTriggerRef,
      focusTrigger,
      save,
      disable,
      completeSetup,
      pendingSetup,
      flipUnit,
    }),
    [
      form,
      updateForm,
      resetForm,
      validationError,
      currency,
      autoRecharge.config,
      autoRecharge.loading,
      autoRecharge.saving,
      autoRecharge.disabling,
      autoRecharge.error,
      statusMessage,
      setup,
      dataState,
      creditsPerMinorUnit,
      displayExchangeRate,
      canToggleUnits,
      isApproximate,
      summaryLine,
      savedSummaryLine,
      deferCardSetup,
      fixedTopupHint,
      open,
      setOpen,
      titleId,
      registerTriggerRef,
      focusTrigger,
      save,
      disable,
      completeSetup,
      pendingSetup,
      flipUnit,
    ],
  )

  const Comp = asChild ? Slot : 'section'
  return (
    <AutoRechargeContext.Provider value={ctx}>
      <Comp
        ref={forwardedRef}
        className={className}
        aria-label="Automatic credit top-up"
        data-solvapay-auto-recharge=""
        data-state={dataState}
        {...rest}
      >
        {children}
      </Comp>
    </AutoRechargeContext.Provider>
  )
})

const Loading = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeLoading({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Loading')
    if (!ctx.loading) return null
    return (
      <p ref={forwardedRef} className={className} data-solvapay-auto-recharge-loading="" {...rest}>
        {children ?? (
          <>
            <Spinner size="sm" /> Loading auto-recharge settings…
          </>
        )}
      </p>
    )
  },
)

const Card = forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(function AutoRechargeCard(
  { className, children, ...rest },
  forwardedRef,
) {
  return (
    <section
      ref={forwardedRef}
      className={className}
      data-solvapay-auto-recharge-card=""
      {...rest}
    >
      {children}
    </section>
  )
})

const CardHeading = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function AutoRechargeCardHeading({ className, children, ...rest }, forwardedRef) {
    const copy = useCopy()
    return (
      <h3
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-card-heading=""
        {...rest}
      >
        {children ?? copy.autoRecharge.heading}
      </h3>
    )
  },
)

const CardSummary = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeCardSummary({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('CardSummary')
    const copy = useCopy()
    const text = ctx.savedSummaryLine ?? copy.autoRecharge.notConfiguredHint
    return (
      <p
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-card-summary=""
        {...rest}
      >
        {children ?? text}
      </p>
    )
  },
)

type TriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }

const Trigger = forwardRef<HTMLButtonElement, TriggerProps>(function AutoRechargeTrigger(
  { asChild, onClick, children, className, ...rest },
  forwardedRef,
) {
  const ctx = useAutoRechargeCtx('Trigger')
  const copy = useCopy()
  const hasExistingConfig = Boolean(ctx.config?.enabled)
  const label = hasExistingConfig
    ? copy.autoRecharge.modifyTriggerLabel
    : copy.autoRecharge.setupTriggerLabel

  const setRefs = (node: HTMLButtonElement | null) => {
    ctx.registerTriggerRef(node)
    if (typeof forwardedRef === 'function') {
      forwardedRef(node)
    } else if (forwardedRef) {
      forwardedRef.current = node
    }
  }

  const commonProps = {
    'data-solvapay-auto-recharge-trigger': '',
    type: 'button' as const,
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': ctx.open,
    disabled: ctx.loading,
    onClick: composeEventHandlers(onClick, (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      ctx.resetForm()
      ctx.setOpen(true)
    }),
    className,
    ...rest,
  }

  if (asChild) {
    return (
      <Slot ref={setRefs as React.Ref<HTMLElement>} {...(commonProps as Record<string, unknown>)}>
        {children ?? label}
      </Slot>
    )
  }
  return (
    <button ref={setRefs} {...commonProps}>
      {children ?? label}
    </button>
  )
})

const Overlay = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AutoRechargeOverlay({ onClick, className, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Overlay')
    return (
      <div
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-overlay=""
        aria-hidden="true"
        onClick={composeEventHandlers(onClick, () => {
          ctx.resetForm()
          ctx.setOpen(false)
          ctx.focusTrigger()
        })}
        {...rest}
      />
    )
  },
)

type ContentProps = React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }

const Content = forwardRef<HTMLDivElement, ContentProps>(function AutoRechargeContent(
  { className, children, ...rest },
  forwardedRef,
) {
  const ctx = useAutoRechargeCtx('Content')
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!ctx.open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        ctx.resetForm()
        ctx.setOpen(false)
        ctx.focusTrigger()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const focusTarget = panelRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )
    focusTarget?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [ctx])

  if (!ctx.open || typeof document === 'undefined') return null

  return createPortal(
    <div data-solvapay-auto-recharge-portal="">
      <Overlay />
      <div
        ref={node => {
          panelRef.current = node
          if (typeof forwardedRef === 'function') {
            forwardedRef(node)
          } else if (forwardedRef) {
            forwardedRef.current = node
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ctx.titleId}
        className={className}
        data-solvapay-auto-recharge-content=""
        {...rest}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
})

const Title = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function AutoRechargeTitle({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Title')
    const copy = useCopy()
    return (
      <h2
        ref={forwardedRef}
        id={ctx.titleId}
        className={className}
        data-solvapay-auto-recharge-title=""
        {...rest}
      >
        {children ?? copy.autoRecharge.settingsHeading}
      </h2>
    )
  },
)

const EnableQuestion = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeEnableQuestion({ className, children, ...rest }, forwardedRef) {
    const copy = useCopy()
    return (
      <p ref={forwardedRef} className={className} data-solvapay-auto-recharge-question="" {...rest}>
        {children ?? copy.autoRecharge.enableQuestion}
      </p>
    )
  },
)

const EnableSentence = forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  function AutoRechargeEnableSentence({ className, children, ...rest }, forwardedRef) {
    const copy = useCopy()
    return (
      <label
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-enable-sentence=""
        {...rest}
      >
        {children ?? copy.autoRecharge.enableSentence}
      </label>
    )
  },
)

const EnableRow = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AutoRechargeEnableRow({ className, children, ...rest }, forwardedRef) {
    const enableId = useId()
    return (
      <div
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-enable-row=""
        {...rest}
      >
        {children ?? (
          <>
            <EnableSwitch appearance="checkbox" id={enableId} />
            <EnableSentence htmlFor={enableId} />
          </>
        )}
      </div>
    )
  },
)

type CancelButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }

const CancelButton = forwardRef<HTMLButtonElement, CancelButtonProps>(
  function AutoRechargeCancelButton(
    { asChild, onClick, children, className, ...rest },
    forwardedRef,
  ) {
    const ctx = useAutoRechargeCtx('CancelButton')
    const copy = useCopy()
    const commonProps = {
      'data-solvapay-auto-recharge-cancel': '',
      type: 'button' as const,
      onClick: composeEventHandlers(onClick, (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        ctx.resetForm()
        ctx.setOpen(false)
        ctx.focusTrigger()
      }),
      className,
      ...rest,
    }

    if (asChild) {
      return (
        <Slot
          ref={forwardedRef as React.Ref<HTMLElement>}
          {...(commonProps as Record<string, unknown>)}
        >
          {children ?? copy.autoRecharge.cancelButton}
        </Slot>
      )
    }
    return (
      <button ref={forwardedRef} {...commonProps}>
        {children ?? copy.autoRecharge.cancelButton}
      </button>
    )
  },
)

const Header = forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  function AutoRechargeHeader({ className, ...rest }, forwardedRef) {
    const copy = useCopy()
    const headingId = useId()
    return (
      <header
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-header=""
        {...rest}
      >
        <section data-solvapay-auto-recharge-heading-group="">
          <h3 id={headingId} data-solvapay-auto-recharge-heading="">
            {copy.autoRecharge.heading}
          </h3>
          <Description />
        </section>
        <EnableSwitch aria-labelledby={headingId} />
      </header>
    )
  },
)

const Description = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeDescription({ className, children, ...rest }, forwardedRef) {
    const copy = useCopy()
    return (
      <p
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-description=""
        {...rest}
      >
        {children ?? copy.autoRecharge.description}
      </p>
    )
  },
)

type EnableSwitchProps = React.InputHTMLAttributes<HTMLInputElement> & {
  asChild?: boolean
  appearance?: 'switch' | 'checkbox'
}

const EnableSwitch = forwardRef<HTMLInputElement, EnableSwitchProps>(
  function AutoRechargeEnableSwitch(
    { asChild, appearance = 'switch', onChange, className, ...rest },
    forwardedRef,
  ) {
    const ctx = useAutoRechargeCtx('EnableSwitch')
    const copy = useCopy()
    const commonProps = {
      'data-solvapay-auto-recharge-enable': '',
      'data-appearance': appearance,
      type: 'checkbox',
      ...(appearance === 'switch'
        ? { role: 'switch' as const, 'aria-checked': ctx.form.enabled }
        : {}),
      checked: ctx.form.enabled,
      'aria-label': copy.autoRecharge.enableLabel,
      disabled: ctx.loading || ctx.saving || ctx.disabling || !!ctx.setup,
      onChange: composeEventHandlers(onChange, (event: React.ChangeEvent<HTMLInputElement>) => {
        ctx.updateForm({ enabled: event.currentTarget.checked })
      }),
      className,
      ...rest,
    }

    if (asChild) {
      return (
        <Slot
          ref={forwardedRef as React.Ref<HTMLElement>}
          {...(commonProps as Record<string, unknown>)}
        />
      )
    }
    return <input ref={forwardedRef} {...commonProps} />
  },
)

const Fields = forwardRef<HTMLFieldSetElement, React.FieldsetHTMLAttributes<HTMLFieldSetElement>>(
  function AutoRechargeFields({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Fields')
    const copy = useCopy()
    if (!ctx.form.enabled) return null

    return (
      <fieldset
        ref={forwardedRef}
        className={className}
        disabled={ctx.saving || ctx.disabling}
        data-solvapay-auto-recharge-fields=""
        data-solvapay-auto-recharge-body=""
        data-state="open"
        {...rest}
      >
        <legend className="sr-only">{copy.autoRecharge.heading}</legend>
        {children ?? (
          <>
            <Summary />
            <ThresholdField />
            <TopupField />
            <MaxMonthlySpendField />
            <DeepDrawdownExplainer />
            <ValidationError />
          </>
        )}
      </fieldset>
    )
  },
)

const Setup = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AutoRechargeSetup({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Setup')
    if (!ctx.setup) return null

    return (
      <div
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-setup-panel=""
        {...rest}
      >
        {children ?? (
          <CardSetup setup={ctx.setup} onComplete={ctx.completeSetup} onPending={ctx.pendingSetup} />
        )}
      </div>
    )
  },
)

const Body = forwardRef<HTMLFieldSetElement, React.FieldsetHTMLAttributes<HTMLFieldSetElement>>(
  function AutoRechargeBody({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Body')
    if (ctx.setup) {
      return <Setup className={className} />
    }
    if (!ctx.form.enabled) return null

    return (
      <Fields ref={forwardedRef} className={className} {...rest}>
        {children ?? (
          <>
            <Summary />
            <ThresholdField />
            <TopupField />
            <MaxMonthlySpendField />
            <DeepDrawdownExplainer />
            <ValidationError />
            <Actions />
          </>
        )}
      </Fields>
    )
  },
)

const Summary = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeSummary({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Summary')
    const copy = useCopy()
    if (!ctx.summaryLine) return null
    return (
      <div data-solvapay-auto-recharge-summary="">
        <p ref={forwardedRef} className={className} {...rest}>
          {children ?? ctx.summaryLine}
        </p>
        <p className="text-xs text-muted-foreground">{copy.autoRecharge.taxDisclosure}</p>
      </div>
    )
  },
)

type AmountFieldProps = {
  field: 'threshold' | 'fixed'
  showLabel?: boolean
  asChild?: boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'children'>

const AmountField = forwardRef<HTMLInputElement, AmountFieldProps>(function AutoRechargeAmountField(
  { field, showLabel = true, asChild, onChange, className, ...rest },
  forwardedRef,
) {
  const ctx = useAutoRechargeCtx('AmountField')
  const copy = useCopy()

  const fieldConfig = {
    threshold: {
      label: copy.autoRecharge.thresholdLabel,
      ariaLabel: copy.autoRecharge.thresholdAriaLabel,
      unitToggleLabel: 'balance threshold',
      value: ctx.form.thresholdAmountMajor,
      unit: ctx.form.thresholdUnit,
      unitKey: 'thresholdUnit' as const,
      valueKey: 'thresholdAmountMajor' as const,
      baseValueKey: 'thresholdBaseValue' as const,
      baseUnitKey: 'thresholdBaseUnit' as const,
      mode: ctx.form.thresholdUnit === 'currency' ? 'currency' : 'number',
      onValue: (value: string) =>
        ctx.updateForm({
          thresholdAmountMajor: value,
          thresholdBaseValue: value,
          thresholdBaseUnit: ctx.form.thresholdUnit,
        }),
    },
    fixed: {
      label: copy.autoRecharge.fixedAmountLabel,
      ariaLabel: copy.autoRecharge.fixedAmountAriaLabel,
      unitToggleLabel: 'fixed top-up amount',
      value: ctx.form.topupAmountMajor,
      unit: ctx.form.topupUnit,
      unitKey: 'topupUnit' as const,
      valueKey: 'topupAmountMajor' as const,
      baseValueKey: 'topupBaseValue' as const,
      baseUnitKey: 'topupBaseUnit' as const,
      mode: ctx.form.topupUnit === 'currency' ? 'currency' : 'number',
      onValue: (value: string) =>
        ctx.updateForm({
          topupAmountMajor: value,
          topupBaseValue: value,
          topupBaseUnit: ctx.form.topupUnit,
        }),
    },
  }[field]

  const inputId = useId()
  const prefix = fieldConfig.mode === 'currency' ? getCurrencySymbol(ctx.currency) : undefined

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value
    const next =
      fieldConfig.mode === 'currency' ? raw.replace(/[^0-9.]/g, '') : raw.replace(/[^0-9]/g, '')
    fieldConfig.onValue(next)
  }

  const inputProps = {
    id: inputId,
    'data-solvapay-auto-recharge-amount': '',
    'data-field': field,
    type: 'text',
    inputMode: fieldConfig.mode === 'currency' ? ('decimal' as const) : ('numeric' as const),
    placeholder: fieldConfig.mode === 'currency' ? '0.00' : '0',
    value: fieldConfig.value,
    'aria-label': fieldConfig.ariaLabel,
    onChange: composeEventHandlers(onChange, handleChange),
    className,
    ...rest,
  }

  const slotRef = forwardedRef as React.Ref<HTMLElement>

  return (
    <p data-solvapay-auto-recharge-field="" data-field={field}>
      {showLabel ? <label htmlFor={inputId}>{fieldConfig.label}</label> : null}
      <span data-solvapay-auto-recharge-amount-row="">
        {prefix ? (
          <span data-solvapay-auto-recharge-currency-prefix="" aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        {asChild ? (
          <Slot ref={slotRef} {...(inputProps as Record<string, unknown>)} />
        ) : (
          <input ref={forwardedRef} {...inputProps} />
        )}
        {ctx.canToggleUnits ? (
          <UnitToggle
            unit={fieldConfig.unit}
            fieldLabel={fieldConfig.unitToggleLabel}
            onToggle={() =>
              ctx.flipUnit(
                fieldConfig.valueKey,
                fieldConfig.unitKey,
                fieldConfig.baseValueKey,
                fieldConfig.baseUnitKey,
                fieldConfig.unit,
              )
            }
          />
        ) : null}
      </span>
    </p>
  )
})

const ThresholdField = forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  function AutoRechargeThresholdField({ className, ...rest }, ref) {
    return (
      <section ref={ref} className={className} {...rest}>
        <AmountField field="threshold" />
      </section>
    )
  },
)

const TopupField = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeTopupField({ className, ...rest }, ref) {
    return (
      <section
        ref={ref as React.Ref<HTMLElement>}
        className={className}
        data-solvapay-auto-recharge-topup-field=""
        {...rest}
      >
        <AmountField field="fixed" />
        <Hint />
      </section>
    )
  },
)

const MaxMonthlySpendField = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'children'>
>(function AutoRechargeMaxMonthlySpendField({ onChange, className, ...rest }, forwardedRef) {
  const ctx = useAutoRechargeCtx('MaxMonthlySpendField')
  const copy = useCopy()
  const inputId = useId()
  const prefix = getCurrencySymbol(ctx.currency)

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.replace(/[^0-9.]/g, '')
    ctx.updateForm({ maxMonthlySpendMajor: raw })
  }

  return (
    <section data-solvapay-auto-recharge-field="" data-field="max-monthly-spend">
      <label htmlFor={inputId}>{copy.autoRecharge.maxMonthlySpendLabel}</label>
      <span data-solvapay-auto-recharge-amount-row="">
        <span data-solvapay-auto-recharge-currency-prefix="" aria-hidden="true">
          {prefix}
        </span>
        <input
          ref={forwardedRef}
          id={inputId}
          data-solvapay-auto-recharge-amount=""
          data-field="max-monthly-spend"
          type="text"
          inputMode="decimal"
          placeholder={copy.autoRecharge.maxMonthlySpendPlaceholder}
          value={ctx.form.maxMonthlySpendMajor}
          aria-label={copy.autoRecharge.maxMonthlySpendAriaLabel}
          onChange={composeEventHandlers(onChange, handleChange)}
          className={className}
          {...rest}
        />
      </span>
      <p data-solvapay-auto-recharge-max-spend-helper="">{copy.autoRecharge.maxMonthlySpendHelper}</p>
    </section>
  )
})

const DeepDrawdownExplainer = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function AutoRechargeDeepDrawdownExplainer({ className, ...rest }, forwardedRef) {
  const copy = useCopy()
  return (
    <p
      ref={forwardedRef}
      className={className}
      data-solvapay-auto-recharge-deep-drawdown=""
      {...rest}
    >
      {copy.autoRecharge.deepDrawdownExplainer}
    </p>
  )
})

const MonthlySpend = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeMonthlySpend({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('MonthlySpend')
    const copy = useCopy()
    if (!ctx.config?.maxMonthlySpendMinor) return null
    const spent = effectiveMonthlySpend(ctx.config)
    return (
      <p
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-monthly-spend=""
        {...rest}
      >
        {children ??
          interpolate(copy.autoRecharge.monthlySpendLine, {
            spent: formatPrice(spent, ctx.currency, { free: '' }),
            cap: formatPrice(ctx.config.maxMonthlySpendMinor, ctx.currency, { free: '' }),
          })}
      </p>
    )
  },
)

type UnitToggleProps = {
  unit: AmountInputUnit
  fieldLabel: string
  onToggle: () => void
}

const UnitToggle = forwardRef<
  HTMLButtonElement,
  UnitToggleProps & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function AutoRechargeUnitToggle(
  { unit, fieldLabel, onToggle, className, ...rest },
  forwardedRef,
) {
  const ctx = useAutoRechargeCtx('UnitToggle')
  const targetUnitLabel = unit === 'currency' ? 'credits' : 'currency'
  return (
    <button
      ref={forwardedRef}
      type="button"
      className={className}
      data-solvapay-auto-recharge-unit-toggle=""
      aria-label={`Switch ${fieldLabel} to ${targetUnitLabel}`}
      onClick={onToggle}
      {...rest}
    >
      {unit === 'currency' ? ctx.currency.toUpperCase() : 'credits'}
    </button>
  )
})

const Hint = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeHint({ className, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Hint')
    const copy = useCopy()
    const hint = ctx.fixedTopupHint
    if (!hint) return null

    const isCreditsHint = ctx.form.topupUnit === 'currency'
    const text = isCreditsHint
      ? interpolate(
          ctx.isApproximate
            ? copy.autoRecharge.creditsPerRechargeApprox
            : copy.autoRecharge.creditsPerRecharge,
          { credits: new Intl.NumberFormat().format(Number(hint)) },
        )
      : interpolate(
          ctx.isApproximate
            ? copy.autoRecharge.currencyPerRechargeApprox
            : copy.autoRecharge.currencyPerRecharge,
          { amount: hint },
        )

    return (
      <p ref={forwardedRef} className={className} data-solvapay-auto-recharge-hint="" {...rest}>
        {text}
      </p>
    )
  },
)

const ValidationError = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function AutoRechargeValidationError({ className, ...rest }, forwardedRef) {
  const ctx = useAutoRechargeCtx('ValidationError')
  if (!ctx.validationError) return null
  return (
    <p
      ref={forwardedRef}
      role="alert"
      aria-live="polite"
      className={className}
      data-solvapay-auto-recharge-validation-error=""
      {...rest}
    >
      {ctx.validationError}
    </p>
  )
})

const Actions = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AutoRechargeActions({ className, children, ...rest }, forwardedRef) {
    return (
      <menu
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-actions=""
        {...rest}
      >
        {children ?? (
          <>
            <li>
              <CancelButton />
            </li>
            <li>
              <SaveButton />
            </li>
          </>
        )}
      </menu>
    )
  },
)

type SaveButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }

const SaveButton = forwardRef<HTMLButtonElement, SaveButtonProps>(function AutoRechargeSaveButton(
  { asChild, onClick, children, className, ...rest },
  forwardedRef,
) {
  const ctx = useAutoRechargeCtx('SaveButton')
  const copy = useCopy()
  const dataState = ctx.saving ? 'processing' : ctx.validationError ? 'disabled' : 'idle'
  const commonProps = {
    'data-solvapay-auto-recharge-save': '',
    'data-state': dataState,
    type: 'button' as const,
    disabled: ctx.saving || ctx.disabling || !!ctx.validationError,
    'aria-busy': ctx.saving,
    onClick: composeEventHandlers(onClick, (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      void ctx.save()
    }),
    className,
    ...rest,
  }

  const content = ctx.saving ? (
    <>
      <Spinner size="sm" /> {copy.cta.processing}
    </>
  ) : (
    (children ?? copy.autoRecharge.saveButton)
  )

  if (asChild) {
    return (
      <Slot
        ref={forwardedRef as React.Ref<HTMLElement>}
        {...(commonProps as Record<string, unknown>)}
      >
        {content}
      </Slot>
    )
  }
  return (
    <button ref={forwardedRef} {...commonProps}>
      {content}
    </button>
  )
})

type DisableButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }

const DisableButton = forwardRef<HTMLButtonElement, DisableButtonProps>(
  function AutoRechargeDisableButton(
    { asChild, onClick, children, className, ...rest },
    forwardedRef,
  ) {
    const ctx = useAutoRechargeCtx('DisableButton')
    const copy = useCopy()
    if (!ctx.config) return null

    const commonProps = {
      'data-solvapay-auto-recharge-disable': '',
      type: 'button' as const,
      disabled: ctx.saving || ctx.disabling,
      'aria-busy': ctx.disabling,
      onClick: composeEventHandlers(onClick, (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        void ctx.disable()
      }),
      className,
      ...rest,
    }

    if (asChild) {
      return (
        <Slot
          ref={forwardedRef as React.Ref<HTMLElement>}
          {...(commonProps as Record<string, unknown>)}
        >
          {children ?? copy.autoRecharge.disableButton}
        </Slot>
      )
    }
    return (
      <button ref={forwardedRef} {...commonProps}>
        {children ?? copy.autoRecharge.disableButton}
      </button>
    )
  },
)

const ErrorSlot = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeError({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Error')
    if (!ctx.error) return null
    return (
      <p
        ref={forwardedRef}
        role="alert"
        aria-live="polite"
        className={className}
        data-solvapay-auto-recharge-error=""
        {...rest}
      >
        {children ?? ctx.error.message}
      </p>
    )
  },
)

const StatusMessage = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeStatusMessage({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('StatusMessage')
    if (!ctx.statusMessage) return null
    return (
      <p
        ref={forwardedRef}
        aria-live="polite"
        className={className}
        data-solvapay-auto-recharge-status-message=""
        {...rest}
      >
        {children ?? ctx.statusMessage}
      </p>
    )
  },
)

const Status = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AutoRechargeStatus({ className, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Status')
    const copy = useCopy()
    const status = ctx.config?.status
    const monthlyCapReached = ctx.config ? isMonthlySpendCapReached(ctx.config) : false
    const failedLabel = status === 'failed' ? copy.autoRecharge.statusFailed : null
    const capLabel = monthlyCapReached ? copy.autoRecharge.statusMonthlyCapReached : null

    if (!failedLabel && !capLabel) return null

    return (
      <div
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-status-group=""
        {...rest}
      >
        {failedLabel ? (
          <span data-solvapay-auto-recharge-status="" data-status="failed">
            {failedLabel}
          </span>
        ) : null}
        {capLabel ? (
          <span data-solvapay-auto-recharge-status="" data-status="monthly-cap-reached">
            {capLabel}
          </span>
        ) : null}
      </div>
    )
  },
)

type CardSetupProps = {
  /** The save response that asked for a card. */
  setup: SaveAutoRechargeResponse
  onComplete: () => void | Promise<void>
  /** Called when the save settles asynchronously (`processing`). */
  onPending?: () => void | Promise<void>
}

/**
 * Collect a card for auto-recharge without paying: vault `CardFields`
 * under a grant on a customer session, then `saveCard` on that session.
 */
function CardSetup({ onComplete, onPending }: CardSetupProps) {
  const copy = useCopy()
  const transport = useTransport()
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null)
  const appearance = useAppearance(formEl)
  const [grant, setGrant] = useState<CaptureGrant | null>(null)
  // The hosted fields are keyed on the first session so refreshing an
  // expired grant at submit does not remount them and drop the entry.
  const [fieldsKey, setFieldsKey] = useState<string | null>(null)
  const [capture, setCapture] = useState<CardCapture | null>(null)
  const setCaptureStable = useCallback((next: CardCapture | null) => setCapture(() => next), [])
  const [complete, setComplete] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const createGrant = transport.createCardSetupGrant
  useEffect(() => {
    if (!createGrant) {
      setError(copy.errors.cardFieldsMissing)
      return
    }
    let cancelled = false
    createGrant()
      .then(next => {
        if (cancelled) return
        setGrant(next)
        setFieldsKey(prev => prev ?? sessionIdOf(next))
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : copy.autoRecharge.setupAuthFailed)
      })
    return () => {
      cancelled = true
    }
  }, [createGrant, copy])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!grant || !capture || !transport.saveCard || !transport.createCardSetupGrant) {
      setError(copy.errors.cardFieldsMissing)
      return
    }
    setProcessing(true)
    setError(null)
    setPending(false)
    let redirecting = false
    try {
      let active = grant
      if (active.expiresAt <= Date.now()) {
        active = await transport.createCardSetupGrant()
        setGrant(active)
      }
      const sessionId = sessionIdOf(active)
      if (!sessionId) throw new Error(copy.autoRecharge.setupAuthFailed)
      const card = await capture(active)
      const resume = { sessionId, cardId: card.cardId }
      const result = await transport.saveCard({
        ...resume,
        returnUrl: buildCardSetupReturnUrl(window.location.href, resume),
      })
      if (result.status === 'succeeded') {
        await onComplete()
      } else if (result.status === 'requires_action' && result.redirectUrl) {
        // 3DS on the rail; the Root resumes on return and posts the same card again.
        redirecting = true
        window.location.assign(result.redirectUrl)
      } else if (result.status === 'processing') {
        setPending(true)
        await onPending?.()
      } else {
        setError(copy.autoRecharge.setupAuthFailed)
      }
    } catch (err) {
      setError(
        err instanceof CardCaptureError
          ? copy.errors.cardCaptureFailed
          : err instanceof Error && err.message
            ? err.message
            : copy.autoRecharge.setupAuthFailed,
      )
    } finally {
      if (!redirecting) setProcessing(false)
    }
  }

  const vault = grant ? { tenantId: grant.tenantId, environment: grant.environment } : null

  return (
    <form ref={setFormEl} onSubmit={handleSubmit} data-solvapay-auto-recharge-setup="">
      <h4>{copy.autoRecharge.setupHeading}</h4>
      <p>{copy.autoRecharge.setupDescription}</p>
      {grant ? (
        <VaultCardFields
          vault={vault}
          paymentIntentId={fieldsKey}
          appearance={appearance}
          onCapture={setCaptureStable}
          onComplete={setComplete}
        />
      ) : !error ? (
        <p data-solvapay-auto-recharge-setup-loading="">
          <Spinner size="sm" /> Loading card form…
        </p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="polite" data-solvapay-auto-recharge-setup-error="">
          {error}
        </p>
      ) : null}
      {pending ? (
        <p role="status" aria-live="polite" data-solvapay-auto-recharge-setup-pending="">
          {copy.autoRecharge.setupAwaitingConfirmation}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={processing || !capture || !complete}
        data-solvapay-auto-recharge-setup-submit=""
      >
        {processing ? copy.autoRecharge.setupProcessing : copy.autoRecharge.setupSubmit}
      </button>
    </form>
  )
}

function sessionIdOf(grant: CaptureGrant): string | null {
  return 'sessionId' in grant.scope && grant.scope.sessionId ? grant.scope.sessionId : null
}

export const AutoRechargeRoot = Root
export const AutoRechargeLoading = Loading
export const AutoRechargeCard = Card
export const AutoRechargeCardHeading = CardHeading
export const AutoRechargeCardSummary = CardSummary
export const AutoRechargeTrigger = Trigger
export const AutoRechargeOverlay = Overlay
export const AutoRechargeContent = Content
export const AutoRechargeTitle = Title
export const AutoRechargeEnableQuestion = EnableQuestion
export const AutoRechargeEnableSentence = EnableSentence
export const AutoRechargeEnableRow = EnableRow
export const AutoRechargeCancelButton = CancelButton
export const AutoRechargeHeader = Header
export const AutoRechargeDescription = Description
export const AutoRechargeEnableSwitch = EnableSwitch
export const AutoRechargeFields = Fields
export const AutoRechargeSetup = Setup
export const AutoRechargeBody = Body
export const AutoRechargeSummary = Summary
export const AutoRechargeThresholdField = ThresholdField
export const AutoRechargeTopupField = TopupField
export const AutoRechargeMaxMonthlySpendField = MaxMonthlySpendField
export const AutoRechargeMonthlySpend = MonthlySpend
export const AutoRechargeAmountField = AmountField
export const AutoRechargeUnitToggle = UnitToggle
export const AutoRechargeHint = Hint
export const AutoRechargeValidationError = ValidationError
export const AutoRechargeActions = Actions
export const AutoRechargeSaveButton = SaveButton
export const AutoRechargeDisableButton = DisableButton
export const AutoRechargeError = ErrorSlot
export const AutoRechargeStatusMessage = StatusMessage
export const AutoRechargeStatus = Status
export const AutoRechargeCardSetup = CardSetup

export const AutoRecharge = {
  Root,
  Loading,
  Card,
  CardHeading,
  CardSummary,
  Trigger,
  Overlay,
  Content,
  Title,
  EnableQuestion,
  EnableSentence,
  EnableRow,
  CancelButton,
  Header,
  Description,
  EnableSwitch,
  Fields,
  Setup,
  Body,
  Summary,
  ThresholdField,
  TopupField,
  MaxMonthlySpendField,
  MonthlySpend,
  AmountField,
  UnitToggle,
  Hint,
  ValidationError,
  Actions,
  SaveButton,
  DisableButton,
  Error: ErrorSlot,
  StatusMessage,
  Status,
  CardSetup,
} as const

export function useAutoRechargeForm(): AutoRechargeContextValue {
  return useAutoRechargeCtx('useAutoRechargeForm')
}

export type { AutoRechargeFormState, AutoRechargeInputPayload }
