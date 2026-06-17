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
  useState,
} from 'react'
import {
  Elements,
  PaymentElement as StripePaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import { loadStripe, type Stripe, type StripeConstructorOptions } from '@stripe/stripe-js'
import type { AutoRechargeConfig, SaveAutoRechargeResponse } from '@solvapay/server'
import { Slot } from './slot'
import { composeEventHandlers } from './composeEventHandlers'
import { withPaymentElementDefaults } from './paymentElementDefaults'
import { useAutoRecharge } from '../hooks/useAutoRecharge'
import { useBalance } from '../hooks/useBalance'
import { useCopy } from '../hooks/useCopy'
import { interpolate } from '../i18n/interpolate'
import { Spinner } from '../components/Spinner'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import {
  buildSummaryLine,
  configToForm,
  convertAmountForUnitFlip,
  createDefaultAutoRechargeForm,
  validateAutoRechargeForm,
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
  fixedTopupHint: string | null
  targetBalanceHint: string | null
  save: () => Promise<void>
  disable: () => Promise<void>
  flipUnit: (
    valueKey: 'thresholdAmountMajor' | 'topupAmountMajor' | 'targetCredits',
    unitKey: 'thresholdUnit' | 'topupUnit' | 'targetUnit',
    currentUnit: AmountInputUnit,
    currentValue: string,
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
    const parts = new Intl.NumberFormat('en', { style: 'currency', currency }).formatToParts(0)
    const sym = parts.find(p => p.type === 'currency')
    return sym?.value ?? currency.toUpperCase()
  } catch {
    return currency.toUpperCase()
  }
}

const stripePromiseCache = new Map<string, Promise<Stripe | null>>()

function getStripeCacheKey(publishableKey: string, accountId?: string): string {
  return accountId ? `${publishableKey}:${accountId}` : publishableKey
}

type RootProps = {
  currency?: string
  defaultThresholdAmountMajor?: number
  defaultTopupAmountMajor?: number
  onSetupRequired?: (result: SaveAutoRechargeResponse) => void | Promise<void>
  onSaved?: (result: SaveAutoRechargeResponse) => void | Promise<void>
  onDisabled?: () => void | Promise<void>
  asChild?: boolean
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'children'>

const Root = forwardRef<HTMLElement, RootProps>(function AutoRechargeRoot(
  {
    currency = 'USD',
    defaultThresholdAmountMajor,
    defaultTopupAmountMajor,
    onSetupRequired,
    onSaved,
    onDisabled,
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
  const defaultTopup =
    defaultTopupAmountMajor ?? defaultThresholdAmountMajor ?? undefined

  const [form, setForm] = useState<AutoRechargeFormState>(() =>
    autoRecharge.config
      ? configToForm(autoRecharge.config, currency)
      : createDefaultAutoRechargeForm(currency, defaultTopup),
  )
  const [validationError, setValidationError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [setup, setSetup] = useState<SaveAutoRechargeResponse | null>(null)

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
      const result = validateAutoRechargeForm(next, currency, {
        creditsPerMinorUnit,
        displayExchangeRate,
      })
      if (!result.ok) {
        setValidationError(result.error)
        return null
      }
      setValidationError(null)
      return result.payload
    },
    [currency, creditsPerMinorUnit, displayExchangeRate],
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

  const flipUnit = useCallback(
    (
      valueKey: 'thresholdAmountMajor' | 'topupAmountMajor' | 'targetCredits',
      unitKey: 'thresholdUnit' | 'topupUnit' | 'targetUnit',
      currentUnit: AmountInputUnit,
      currentValue: string,
    ) => {
      const nextUnit: AmountInputUnit = currentUnit === 'currency' ? 'credits' : 'currency'
      const converted = convertAmountForUnitFlip(
        currentValue,
        currentUnit,
        nextUnit,
        currency,
        creditsPerMinorUnit,
        displayExchangeRate,
      )
      updateForm({ [unitKey]: nextUnit, [valueKey]: converted } as Partial<AutoRechargeFormState>)
    },
    [currency, creditsPerMinorUnit, displayExchangeRate, updateForm],
  )

  const fixedTopupHint = useMemo(() => {
    if (form.topupMode !== 'fixed') return null
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
    form.topupMode,
    form.topupAmountMajor,
    form.topupUnit,
    currency,
    creditsPerMinorUnit,
    displayExchangeRate,
    isApproximate,
  ])

  const targetBalanceHint = useMemo(() => {
    if (form.topupMode !== 'target') return null
    const parsed = Number(form.targetCredits)
    if (!Number.isFinite(parsed) || parsed <= 0) return null

    if (form.targetUnit === 'currency') {
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
    form.topupMode,
    form.targetCredits,
    form.targetUnit,
    currency,
    creditsPerMinorUnit,
    displayExchangeRate,
    isApproximate,
  ])

  const summaryLine = useMemo(() => buildSummaryLine(form, currency), [form, currency])

  const save = useCallback(async () => {
    const payload = emitValidation(form)
    if (!payload) return

    const result = await autoRecharge.save(payload)
    if (result.setupClientSecret) {
      setSetup(result)
      setStatusMessage(copy.autoRecharge.setupRequiredMessage)
      await onSetupRequired?.(result)
      return
    }
    setSetup(null)
    setStatusMessage(copy.autoRecharge.savedMessage)
    await onSaved?.(result)
  }, [autoRecharge, copy.autoRecharge, emitValidation, form, onSaved, onSetupRequired])

  const disable = useCallback(async () => {
    await autoRecharge.disable()
    setStatusMessage(copy.autoRecharge.disabledMessage)
    setSetup(null)
    await onDisabled?.()
  }, [autoRecharge, copy.autoRecharge, onDisabled])

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
      targetBalanceHint:
        targetBalanceHint && 'credits' in targetBalanceHint
          ? String(targetBalanceHint.credits)
          : targetBalanceHint && 'major' in targetBalanceHint
            ? formatPrice(
                Math.round(targetBalanceHint.major * getMinorUnitsPerMajor(currency)),
                currency,
                { free: '' },
              )
            : null,
      save,
      disable,
      flipUnit,
    }),
    [
      form,
      updateForm,
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
      fixedTopupHint,
      targetBalanceHint,
      save,
      disable,
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
      <p
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-loading=""
        {...rest}
      >
        {children ?? (
          <>
            <Spinner size="sm" /> Loading auto-recharge settings…
          </>
        )}
      </p>
    )
  },
)

const Header = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
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
        <div data-solvapay-auto-recharge-heading-group="">
          <h3 id={headingId} data-solvapay-auto-recharge-heading="">
            {copy.autoRecharge.heading}
          </h3>
          <Description />
        </div>
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

type EnableSwitchProps = React.InputHTMLAttributes<HTMLInputElement> & { asChild?: boolean }

const EnableSwitch = forwardRef<HTMLInputElement, EnableSwitchProps>(
  function AutoRechargeEnableSwitch({ asChild, onChange, className, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('EnableSwitch')
    const copy = useCopy()
    const commonProps = {
      'data-solvapay-auto-recharge-enable': '',
      type: 'checkbox',
      role: 'switch',
      checked: ctx.form.enabled,
      'aria-checked': ctx.form.enabled,
      'aria-label': copy.autoRecharge.enableLabel,
      disabled: ctx.loading || ctx.saving || ctx.disabling,
      onChange: composeEventHandlers(onChange, (event: React.ChangeEvent<HTMLInputElement>) => {
        ctx.updateForm({ enabled: event.currentTarget.checked, showAdvanced: false })
      }),
      className,
      ...rest,
    }

    if (asChild) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)} />
      )
    }
    return <input ref={forwardedRef} {...commonProps} />
  },
)

const Body = forwardRef<HTMLFieldSetElement, React.FieldsetHTMLAttributes<HTMLFieldSetElement>>(
  function AutoRechargeBody({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Body')
    const copy = useCopy()
    if (!ctx.form.enabled && !ctx.setup) return null

    if (ctx.setup?.setupClientSecret) {
      return (
        <CardSetup
          setup={ctx.setup}
          onComplete={() => {
            ctx.updateForm({ enabled: true })
          }}
        />
      )
    }

    return (
      <fieldset
        ref={forwardedRef}
        className={className}
        disabled={ctx.saving || ctx.disabling}
        data-solvapay-auto-recharge-body=""
        data-state={ctx.form.enabled ? 'open' : 'closed'}
        {...rest}
      >
        <legend className="sr-only">{copy.autoRecharge.heading}</legend>
        {children ?? (
          <>
            <Summary />
            <ThresholdField />
            <TopupField />
            <AdvancedToggle />
            <AdvancedPanel />
            <ValidationError />
            <Actions />
          </>
        )}
      </fieldset>
    )
  },
)

const Summary = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeSummary({ className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Summary')
    if (!ctx.summaryLine) return null
    return (
      <p
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-summary=""
        {...rest}
      >
        {children ?? ctx.summaryLine}
      </p>
    )
  },
)

type AmountFieldProps = {
  field: 'threshold' | 'fixed' | 'target' | 'maxRecharges'
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
      mode: ctx.form.thresholdUnit === 'currency' ? 'currency' : 'number',
      onValue: (value: string) => ctx.updateForm({ thresholdAmountMajor: value }),
    },
    fixed: {
      label: copy.autoRecharge.fixedAmountLabel,
      ariaLabel: copy.autoRecharge.fixedAmountAriaLabel,
      unitToggleLabel: 'fixed top-up amount',
      value: ctx.form.topupAmountMajor,
      unit: ctx.form.topupUnit,
      unitKey: 'topupUnit' as const,
      valueKey: 'topupAmountMajor' as const,
      mode: ctx.form.topupUnit === 'currency' ? 'currency' : 'number',
      onValue: (value: string) => ctx.updateForm({ topupAmountMajor: value }),
    },
    target: {
      label: copy.autoRecharge.targetAmountLabel,
      ariaLabel: copy.autoRecharge.targetAmountAriaLabel,
      unitToggleLabel: 'target balance',
      value: ctx.form.targetCredits,
      unit: ctx.form.targetUnit,
      unitKey: 'targetUnit' as const,
      valueKey: 'targetCredits' as const,
      mode: ctx.form.targetUnit === 'currency' ? 'currency' : 'number',
      onValue: (value: string) => ctx.updateForm({ targetCredits: value }),
    },
    maxRecharges: {
      label: copy.autoRecharge.maxRechargesLabel,
      ariaLabel: copy.autoRecharge.maxRechargesAriaLabel,
      unitToggleLabel: 'maximum recharges',
      value: ctx.form.maxRecharges,
      unit: 'currency' as AmountInputUnit,
      unitKey: 'thresholdUnit' as const,
      valueKey: 'thresholdAmountMajor' as const,
      mode: 'number' as const,
      onValue: (value: string) => ctx.updateForm({ maxRecharges: value }),
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
    placeholder: fieldConfig.mode === 'currency' ? '0.00' : field === 'maxRecharges' ? 'Unlimited' : '0',
    value: fieldConfig.value,
    'aria-label': fieldConfig.ariaLabel,
    onChange: composeEventHandlers(onChange, handleChange),
    className,
    ...rest,
  }

  return (
    <div data-solvapay-auto-recharge-field="" data-field={field}>
      {showLabel ? <label htmlFor={inputId}>{fieldConfig.label}</label> : null}
      <div data-solvapay-auto-recharge-amount-row="">
        {prefix ? (
          <span data-solvapay-auto-recharge-currency-prefix="" aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        {asChild ? (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <Slot ref={forwardedRef as any} {...(inputProps as Record<string, unknown>)} />
        ) : (
          <input ref={forwardedRef} {...inputProps} />
        )}
        {field !== 'maxRecharges' && ctx.canToggleUnits ? (
          <UnitToggle
            unit={fieldConfig.unit}
            fieldLabel={fieldConfig.unitToggleLabel}
            onToggle={() =>
              ctx.flipUnit(fieldConfig.valueKey, fieldConfig.unitKey, fieldConfig.unit, fieldConfig.value)
            }
          />
        ) : null}
      </div>
    </div>
  )
})

const ThresholdField = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AutoRechargeThresholdField(props, ref) {
    return (
      <div ref={ref} {...props}>
        <AmountField field="threshold" />
      </div>
    )
  },
)

const TopupField = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AutoRechargeTopupField(props, ref) {
    const ctx = useAutoRechargeCtx('TopupField')
    const copy = useCopy()
    return (
      <div ref={ref} data-solvapay-auto-recharge-topup-field="" {...props}>
        <div data-solvapay-auto-recharge-mode-header="">
          <span>{ctx.form.topupMode === 'fixed' ? copy.autoRecharge.fixedAmountLabel : copy.autoRecharge.targetAmountLabel}</span>
          <ModeToggle />
        </div>
        {ctx.form.topupMode === 'fixed' ? (
          <>
            <AmountField field="fixed" showLabel={false} />
            <Hint kind="fixed" />
          </>
        ) : (
          <>
            <AmountField field="target" showLabel={false} />
            <Hint kind="target" />
          </>
        )}
      </div>
    )
  },
)

const ModeToggle = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function AutoRechargeModeToggle({ onClick, className, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('ModeToggle')
    const copy = useCopy()
    const toTarget = ctx.form.topupMode === 'fixed'
    const label = toTarget ? copy.autoRecharge.switchToTarget : copy.autoRecharge.switchToFixed
    return (
      <button
        ref={forwardedRef}
        type="button"
        className={className}
        data-solvapay-auto-recharge-mode-toggle=""
        aria-label={label}
        onClick={composeEventHandlers(onClick, () => {
          if (ctx.form.topupMode === 'fixed') {
            ctx.updateForm({ topupMode: 'target', targetUnit: ctx.form.topupUnit })
            return
          }
          ctx.updateForm({ topupMode: 'fixed', topupUnit: ctx.form.targetUnit })
        })}
        {...rest}
      >
        ↕
      </button>
    )
  },
)

type UnitToggleProps = {
  unit: AmountInputUnit
  fieldLabel: string
  onToggle: () => void
}

const UnitToggle = forwardRef<HTMLButtonElement, UnitToggleProps & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function AutoRechargeUnitToggle({ unit, fieldLabel, onToggle, className, ...rest }, forwardedRef) {
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
  },
)

type HintProps = { kind: 'fixed' | 'target' }

const Hint = forwardRef<HTMLParagraphElement, HintProps & React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeHint({ kind, className, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Hint')
    const copy = useCopy()
    const hint = kind === 'fixed' ? ctx.fixedTopupHint : ctx.targetBalanceHint
    if (!hint) return null

    const isCreditsHint = kind === 'fixed' ? ctx.form.topupUnit === 'currency' : ctx.form.targetUnit === 'currency'
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
      <p
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-hint=""
        {...rest}
      >
        {text}
      </p>
    )
  },
)

const AdvancedToggle = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function AutoRechargeAdvancedToggle({ onClick, className, children, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('AdvancedToggle')
    const copy = useCopy()
    return (
      <button
        ref={forwardedRef}
        type="button"
        className={className}
        data-solvapay-auto-recharge-advanced-toggle=""
        aria-expanded={ctx.form.showAdvanced}
        onClick={composeEventHandlers(onClick, () => {
          ctx.updateForm({ showAdvanced: !ctx.form.showAdvanced })
        })}
        {...rest}
      >
        {children ?? copy.autoRecharge.advancedLabel}
      </button>
    )
  },
)

const AdvancedPanel = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AutoRechargeAdvancedPanel({ className, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('AdvancedPanel')
    if (!ctx.form.showAdvanced) return null
    return (
      <div
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-advanced=""
        {...rest}
      >
        <AmountField field="maxRecharges" />
      </div>
    )
  },
)

const ValidationError = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AutoRechargeValidationError({ className, ...rest }, forwardedRef) {
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
  },
)

const Actions = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AutoRechargeActions({ className, children, ...rest }, forwardedRef) {
    return (
      <div ref={forwardedRef} className={className} data-solvapay-auto-recharge-actions="" {...rest}>
        {children ?? (
          <>
            <SaveButton />
            <DisableButton />
          </>
        )}
      </div>
    )
  },
)

type SaveButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }

const SaveButton = forwardRef<HTMLButtonElement, SaveButtonProps>(
  function AutoRechargeSaveButton({ asChild, onClick, children, className, ...rest }, forwardedRef) {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)}>
          {content}
        </Slot>
      )
    }
    return (
      <button ref={forwardedRef} {...commonProps}>
        {content}
      </button>
    )
  },
)

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)}>
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

const Status = forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  function AutoRechargeStatus({ className, ...rest }, forwardedRef) {
    const ctx = useAutoRechargeCtx('Status')
    const copy = useCopy()
    const status = ctx.config?.status
    if (!status || status === 'active' || status === 'disabled') return null

    const label =
      status === 'pending_setup'
        ? copy.autoRecharge.statusPendingSetup
        : status === 'failed'
          ? copy.autoRecharge.statusFailed
          : status === 'completed'
            ? copy.autoRecharge.statusCompleted
            : null
    if (!label) return null

    return (
      <span
        ref={forwardedRef}
        className={className}
        data-solvapay-auto-recharge-status=""
        data-status={status}
        {...rest}
      >
        {label}
      </span>
    )
  },
)

type CardSetupProps = {
  setup: SaveAutoRechargeResponse
  onComplete: () => void
}

function CardSetupInner({ onComplete }: { onComplete: () => void }) {
  const copy = useCopy()
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!stripe || !elements) {
      setError('Stripe is still loading. Please wait.')
      return
    }

    setProcessing(true)
    setError(null)

    const { error: submitError } = await elements.submit()
    if (submitError) {
      setError(submitError.message ?? 'Card authorization failed')
      setProcessing(false)
      return
    }

    const { error: confirmError } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: typeof window !== 'undefined' ? window.location.href : '/',
      },
      redirect: 'if_required',
    })

    if (confirmError) {
      setError(confirmError.message ?? 'Card authorization failed')
      setProcessing(false)
      return
    }

    onComplete()
    setProcessing(false)
  }

  return (
    <form onSubmit={handleSubmit} data-solvapay-auto-recharge-setup="">
      <h4>{copy.autoRecharge.setupHeading}</h4>
      <p>{copy.autoRecharge.setupDescription}</p>
      <StripePaymentElement options={withPaymentElementDefaults()} />
      {error ? (
        <p role="alert" aria-live="polite" data-solvapay-auto-recharge-setup-error="">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={processing || !stripe} data-solvapay-auto-recharge-setup-submit="">
        {processing ? copy.autoRecharge.setupProcessing : copy.autoRecharge.setupSubmit}
      </button>
    </form>
  )
}

function CardSetup({ setup, onComplete }: CardSetupProps) {
  const stripePromise = useMemo(() => {
    if (!setup.publishableKey || !setup.setupClientSecret) return null
    const options: StripeConstructorOptions = {
      ...(setup.stripeAccountId ? { stripeAccount: setup.stripeAccountId } : {}),
      developerTools: { assistant: { enabled: false } },
    }
    const cacheKey = getStripeCacheKey(setup.publishableKey, setup.stripeAccountId)
    const cached = stripePromiseCache.get(cacheKey)
    if (cached) return cached
    const promise = loadStripe(setup.publishableKey, options)
    stripePromiseCache.set(cacheKey, promise)
    return promise
  }, [setup.publishableKey, setup.setupClientSecret, setup.stripeAccountId])

  if (!stripePromise || !setup.setupClientSecret) {
    return (
      <p data-solvapay-auto-recharge-setup-loading="">
        <Spinner size="sm" /> Loading card form…
      </p>
    )
  }

  return (
    <Elements key={setup.setupClientSecret} stripe={stripePromise} options={{ clientSecret: setup.setupClientSecret }}>
      <CardSetupInner onComplete={onComplete} />
    </Elements>
  )
}

export const AutoRechargeRoot = Root
export const AutoRechargeLoading = Loading
export const AutoRechargeHeader = Header
export const AutoRechargeDescription = Description
export const AutoRechargeEnableSwitch = EnableSwitch
export const AutoRechargeBody = Body
export const AutoRechargeSummary = Summary
export const AutoRechargeThresholdField = ThresholdField
export const AutoRechargeTopupField = TopupField
export const AutoRechargeAmountField = AmountField
export const AutoRechargeModeToggle = ModeToggle
export const AutoRechargeUnitToggle = UnitToggle
export const AutoRechargeHint = Hint
export const AutoRechargeAdvancedToggle = AdvancedToggle
export const AutoRechargeAdvancedPanel = AdvancedPanel
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
  Header,
  Description,
  EnableSwitch,
  Body,
  Summary,
  ThresholdField,
  TopupField,
  AmountField,
  ModeToggle,
  UnitToggle,
  Hint,
  AdvancedToggle,
  AdvancedPanel,
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
