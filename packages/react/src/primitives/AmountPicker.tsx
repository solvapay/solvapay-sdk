'use client'

/**
 * AmountPicker compound primitive.
 *
 * Unstyled building blocks for the top-up amount selector: quick-pick pills
 * (`Option`), a custom input (`Custom`), and a `Confirm` button that runs
 * the hook's `validate()` before proceeding. State comes from
 * `useTopupAmountSelector` via `Root` and is exposed through
 * `useAmountPicker()` for fully custom layouts.
 *
 * `Option` emits `data-state=idle|selected|disabled` and a numeric
 * `data-amount` attribute; `Custom` emits `data-state=active|dormant`
 * based on whether the custom input holds the active resolved amount.
 */

import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react'
import { Slot } from './slot'
import { composeEventHandlers } from './composeEventHandlers'
import { useTopupAmountSelector } from '../hooks/useTopupAmountSelector'
import { useBalance } from '../hooks/useBalance'
import { useCopy } from '../hooks/useCopy'
import { interpolate } from '../i18n/interpolate'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { UseTopupAmountSelectorReturn } from '../types'

type OptionState = 'idle' | 'selected' | 'disabled'

type AmountPickerContextValue = UseTopupAmountSelectorReturn & {
  currency: string
  creditsPerMinorUnit: number | null
  displayExchangeRate: number | null
  estimatedCredits: number | null
  isApproximate: boolean
}

const AmountPickerContext = createContext<AmountPickerContextValue | null>(null)

function usePickerCtx(part: string): AmountPickerContextValue {
  const ctx = useContext(AmountPickerContext)
  if (!ctx) {
    throw new Error(`AmountPicker.${part} must be rendered inside <AmountPicker.Root>.`)
  }
  return ctx
}

type RootProps = {
  currency: string
  minAmount?: number
  maxAmount?: number
  onChange?: (amount: number | null) => void
  asChild?: boolean
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'onChange'>

const Root = forwardRef<HTMLDivElement, RootProps>(function AmountPickerRoot(
  { currency, minAmount, maxAmount, onChange, asChild, children, ...rest },
  forwardedRef,
) {
  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('AmountPicker')

  const selector = useTopupAmountSelector({ currency, minAmount, maxAmount })
  const { creditsPerMinorUnit, displayExchangeRate } = useBalance()

  useEffect(() => {
    onChange?.(selector.resolvedAmount)
  }, [selector.resolvedAmount, onChange])

  const resolvedAmountMinor =
    selector.resolvedAmount != null && selector.resolvedAmount > 0
      ? Math.round(selector.resolvedAmount * 100)
      : null
  const rate = displayExchangeRate ?? 1
  const estimatedCredits =
    creditsPerMinorUnit != null && creditsPerMinorUnit > 0 && resolvedAmountMinor != null
      ? Math.floor((resolvedAmountMinor / rate) * creditsPerMinorUnit)
      : null
  const isApproximate = rate !== 1

  const ctx = useMemo<AmountPickerContextValue>(
    () => ({
      ...selector,
      currency,
      creditsPerMinorUnit,
      displayExchangeRate,
      estimatedCredits,
      isApproximate,
    }),
    [selector, currency, creditsPerMinorUnit, displayExchangeRate, estimatedCredits, isApproximate],
  )

  const Comp = asChild ? Slot : 'div'
  return (
    <AmountPickerContext.Provider value={ctx}>
      <Comp ref={forwardedRef} data-solvapay-amount-picker="" {...rest}>
        {children}
      </Comp>
    </AmountPickerContext.Provider>
  )
})

type OptionProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
  amount: number
}

const Option = forwardRef<HTMLButtonElement, OptionProps>(function AmountPickerOption(
  { asChild, amount, onClick, children, ...rest },
  forwardedRef,
) {
  const ctx = usePickerCtx('Option')
  const isActive = ctx.selectedAmount === amount && !ctx.customAmount
  const state: OptionState = rest.disabled ? 'disabled' : isActive ? 'selected' : 'idle'

  const commonProps = {
    'data-solvapay-amount-picker-option': '',
    'data-state': state,
    'data-amount': String(amount),
    'aria-pressed': isActive,
    onClick: composeEventHandlers(onClick, () => {
      ctx.selectQuickAmount(amount)
    }),
    ...rest,
  } satisfies React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>

  if (asChild) {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)}>
        {children ?? (
          <>
            {ctx.currencySymbol}
            {amount.toLocaleString()}
          </>
        )}
      </Slot>
    )
  }
  return (
    <button ref={forwardedRef} type="button" {...commonProps}>
      {children ?? (
        <>
          {ctx.currencySymbol}
          {amount.toLocaleString()}
        </>
      )}
    </button>
  )
})

type CustomProps = React.InputHTMLAttributes<HTMLInputElement> & {
  asChild?: boolean
}

const Custom = forwardRef<HTMLInputElement, CustomProps>(function AmountPickerCustom(
  { asChild, onChange, onFocus, ...rest },
  forwardedRef,
) {
  const ctx = usePickerCtx('Custom')
  const state = ctx.customAmount ? 'active' : 'dormant'

  const commonProps = {
    'data-solvapay-amount-picker-custom': '',
    'data-state': state,
    type: 'text',
    inputMode: 'decimal' as const,
    placeholder: '0.00',
    value: ctx.customAmount,
    onChange: composeEventHandlers(onChange, (e: React.ChangeEvent<HTMLInputElement>) => {
      ctx.setCustomAmount(e.target.value)
    }),
    onFocus: composeEventHandlers(onFocus, () => {
      if (ctx.selectedAmount != null) ctx.selectQuickAmount(0)
    }),
    ...rest,
  }

  if (asChild) {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)} />
    )
  }
  return <input ref={forwardedRef} {...commonProps} />
})

type ConfirmProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
  onConfirm?: (amount: number) => void
}

const Confirm = forwardRef<HTMLButtonElement, ConfirmProps>(function AmountPickerConfirm(
  { asChild, onClick, onConfirm, disabled, children, ...rest },
  forwardedRef,
) {
  const ctx = usePickerCtx('Confirm')
  const isDisabled = disabled || !ctx.resolvedAmount

  const handleConfirm = useCallback(() => {
    if (ctx.validate() && ctx.resolvedAmount != null) {
      onConfirm?.(ctx.resolvedAmount)
    }
  }, [ctx, onConfirm])

  const commonProps = {
    'data-solvapay-amount-picker-confirm': '',
    'data-state': isDisabled ? 'disabled' : 'idle',
    disabled: isDisabled,
    'aria-disabled': isDisabled || undefined,
    onClick: composeEventHandlers(onClick, handleConfirm),
    ...rest,
  } satisfies React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>

  if (asChild) {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)}>
        {children}
      </Slot>
    )
  }
  return (
    <button ref={forwardedRef} type="button" {...commonProps}>
      {children}
    </button>
  )
})

export const AmountPickerRoot = Root
export const AmountPickerOption = Option
export const AmountPickerCustom = Custom
export const AmountPickerConfirm = Confirm

export const AmountPicker = {
  Root,
  Option,
  Custom,
  Confirm,
} as const

export function useAmountPicker(): AmountPickerContextValue {
  return usePickerCtx('useAmountPicker')
}

/** Helper for copy consumers composing the default-tree shim. */
export function useAmountPickerCopy(): {
  selectAmountLabel: string
  customAmountLabel: string
  creditEstimate: (credits: number) => string
} {
  const copy = useCopy()
  const ctx = usePickerCtx('useAmountPickerCopy')
  return {
    selectAmountLabel: copy.amountPicker.selectAmountLabel,
    customAmountLabel: copy.amountPicker.customAmountLabel,
    creditEstimate: (credits: number) =>
      interpolate(
        ctx.isApproximate
          ? copy.amountPicker.creditEstimateApprox
          : copy.amountPicker.creditEstimateExact,
        { credits: new Intl.NumberFormat().format(credits) },
      ),
  }
}
