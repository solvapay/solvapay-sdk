'use client'
import React, { useEffect } from 'react'
import { useTopupAmountSelector } from '../hooks/useTopupAmountSelector'
import { useBalance } from '../hooks/useBalance'
import { useCopy } from '../hooks/useCopy'
import { interpolate } from '../i18n/interpolate'
import type { UseTopupAmountSelectorReturn } from '../types'

export interface AmountPickerClassNames {
  root?: string
  label?: string
  pills?: string
  pill?: string
  pillSelected?: string
  customWrapper?: string
  customInput?: string
  currencySymbol?: string
  creditEstimate?: string
  error?: string
}

export interface AmountPickerRenderArgs extends UseTopupAmountSelectorReturn {
  creditsPerMinorUnit: number | null
  displayExchangeRate: number | null
  estimatedCredits: number | null
  isApproximate: boolean
}

export interface AmountPickerProps {
  currency: string
  minAmount?: number
  maxAmount?: number
  showCreditEstimate?: boolean
  onChange?: (amount: number | null) => void
  classNames?: AmountPickerClassNames
  unstyled?: boolean
  className?: string
  children?: (args: AmountPickerRenderArgs) => React.ReactNode
}

/**
 * Styled top-up amount picker. Wraps `useTopupAmountSelector` with a
 * conversion-grade default UI (quick-amount pills + custom input + optional
 * credit estimate) and exposes the raw hook state through a function-child
 * escape hatch for fully custom markup.
 */
export const AmountPicker: React.FC<AmountPickerProps> = ({
  currency,
  minAmount,
  maxAmount,
  showCreditEstimate = true,
  onChange,
  classNames = {},
  unstyled = false,
  className,
  children,
}) => {
  const copy = useCopy()
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

  if (children) {
    return (
      <>
        {children({
          ...selector,
          creditsPerMinorUnit,
          displayExchangeRate,
          estimatedCredits,
          isApproximate,
        })}
      </>
    )
  }

  const styledLabel: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: 'rgba(0,0,0,0.55)',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  }

  const styledPill = (selected: boolean): React.CSSProperties => ({
    padding: '8px 18px',
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 600,
    background: selected ? '#0f172a' : '#fff',
    color: selected ? '#fff' : '#1f2937',
    border: `1px solid ${selected ? '#0f172a' : 'rgba(0,0,0,0.15)'}`,
    cursor: 'pointer',
  })

  return (
    <div
      data-solvapay-amount-picker=""
      className={className ?? classNames.root}
      style={
        unstyled || className || classNames.root
          ? undefined
          : { display: 'flex', flexDirection: 'column', gap: 16 }
      }
    >
      <p
        className={classNames.label}
        style={unstyled || classNames.label ? undefined : styledLabel}
      >
        {copy.amountPicker.selectAmountLabel}
      </p>

      <div
        className={classNames.pills}
        style={
          unstyled || classNames.pills
            ? undefined
            : { display: 'flex', flexWrap: 'wrap', gap: 8 }
        }
      >
        {selector.quickAmounts.map(amount => {
          const isSelected = selector.selectedAmount === amount && !selector.customAmount
          return (
            <button
              key={amount}
              type="button"
              onClick={() => selector.selectQuickAmount(amount)}
              data-selected={isSelected || undefined}
              className={isSelected ? classNames.pillSelected ?? classNames.pill : classNames.pill}
              style={unstyled || classNames.pill ? undefined : styledPill(isSelected)}
            >
              {selector.currencySymbol}
              {amount.toLocaleString()}
            </button>
          )
        })}
      </div>

      <div
        className={classNames.customWrapper}
        style={
          unstyled || classNames.customWrapper
            ? undefined
            : {
                opacity:
                  selector.selectedAmount != null && !selector.customAmount ? 0.45 : 1,
                transition: 'opacity 150ms',
              }
        }
      >
        <p
          style={
            unstyled || classNames.label
              ? undefined
              : { fontSize: 14, color: 'rgba(0,0,0,0.55)', marginBottom: 8 }
          }
        >
          {copy.amountPicker.customAmountLabel}
        </p>
        <div style={unstyled ? undefined : { position: 'relative' }}>
          <span
            className={classNames.currencySymbol}
            style={
              unstyled || classNames.currencySymbol
                ? undefined
                : {
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'rgba(0,0,0,0.45)',
                    pointerEvents: 'none',
                  }
            }
          >
            {selector.currencySymbol}
          </span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={selector.customAmount}
            onChange={e => selector.setCustomAmount(e.target.value)}
            onFocus={() => {
              if (selector.selectedAmount != null) selector.selectQuickAmount(0)
            }}
            className={classNames.customInput}
            style={
              unstyled || classNames.customInput
                ? undefined
                : {
                    width: '100%',
                    padding: '12px 16px 12px 32px',
                    border: '1px solid rgba(0,0,0,0.18)',
                    borderRadius: 8,
                    fontSize: 15,
                    outline: 'none',
                  }
            }
          />
        </div>
      </div>

      {showCreditEstimate && estimatedCredits != null && (
        <p
          className={classNames.creditEstimate}
          style={
            unstyled || classNames.creditEstimate
              ? undefined
              : { fontSize: 14, color: 'rgba(0,0,0,0.6)' }
          }
        >
          {interpolate(
            isApproximate
              ? copy.amountPicker.creditEstimateApprox
              : copy.amountPicker.creditEstimateExact,
            { credits: new Intl.NumberFormat().format(estimatedCredits) },
          )}
        </p>
      )}

      {selector.error && (
        <p
          role="alert"
          className={classNames.error}
          style={
            unstyled || classNames.error
              ? undefined
              : { fontSize: 14, color: '#dc2626' }
          }
        >
          {selector.error}
        </p>
      )}
    </div>
  )
}
