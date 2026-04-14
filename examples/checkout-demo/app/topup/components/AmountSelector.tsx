'use client'

import { useState } from 'react'

function getQuickAmounts(currency: string): number[] {
  switch (currency.toUpperCase()) {
    case 'SEK':
    case 'NOK':
    case 'DKK':
      return [100, 500, 1000, 5000]
    case 'JPY':
      return [1000, 5000, 10000, 50000]
    case 'KRW':
      return [10000, 50000, 100000, 500000]
    case 'ISK':
    case 'HUF':
      return [1000, 5000, 10000, 50000]
    default:
      return [5, 10, 25, 50]
  }
}

function getCurrencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat('en', { style: 'currency', currency }).formatToParts(0)
    return parts.find(p => p.type === 'currency')?.value || currency
  } catch {
    return currency
  }
}

function formatCurrencyFromMajorUnits(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

interface AmountSelectorProps {
  onSelect: (amountCents: number) => void
  currency: string
  creditsPerMinorUnit?: number | null
  displayExchangeRate?: number | null
  className?: string
}

export function AmountSelector({
  onSelect,
  currency,
  creditsPerMinorUnit,
  displayExchangeRate,
  className,
}: AmountSelectorProps) {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [isCustom, setIsCustom] = useState(false)

  const handlePresetClick = (cents: number) => {
    setSelectedPreset(cents)
    setIsCustom(false)
    setCustomAmount('')
  }

  const handleCustomFocus = () => {
    setIsCustom(true)
    setSelectedPreset(null)
  }

  const handleCustomChange = (value: string) => {
    const sanitized = value.replace(/[^0-9.]/g, '')
    setCustomAmount(sanitized)
  }

  const activeAmount = isCustom
    ? Math.round(parseFloat(customAmount || '0') * 100)
    : selectedPreset

  const exchangeRate = displayExchangeRate ?? 1
  const isValid = activeAmount !== null && activeAmount > 0
  const estimatedCredits =
    creditsPerMinorUnit != null && creditsPerMinorUnit > 0 && activeAmount != null && activeAmount > 0
      ? Math.floor((activeAmount / exchangeRate) * creditsPerMinorUnit)
      : null
  const isApproximate = exchangeRate !== 1
  const symbol = getCurrencySymbol(currency)

  return (
    <div className={className}>
      <h3 className="text-sm font-medium text-slate-900 mb-4">Select amount</h3>

      <div className="grid grid-cols-4 gap-3 mb-4">
        {getQuickAmounts(currency).map(amountMajor => {
          const cents = amountMajor * 100
          return (
          <button
            key={cents}
            type="button"
            onClick={() => handlePresetClick(cents)}
            className={`py-3 rounded-lg border text-sm font-medium transition-colors ${
              !isCustom && selectedPreset === cents
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
            }`}
          >
            {formatCurrencyFromMajorUnits(amountMajor, currency)}
          </button>
          )
        })}
      </div>

      <div className="mb-6">
        <label htmlFor="custom-amount" className="text-xs text-slate-500 mb-1 block">
          Or enter a custom amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{symbol}</span>
          <input
            id="custom-amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={customAmount}
            onFocus={handleCustomFocus}
            onChange={e => handleCustomChange(e.target.value)}
            style={{ paddingLeft: `${0.75 + symbol.length * 0.65}rem` }}
            className={`w-full pr-4 py-2.5 rounded-lg border text-sm transition-colors ${
              isCustom
                ? 'border-slate-900 ring-1 ring-slate-900'
                : 'border-slate-200'
            } focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900`}
          />
        </div>
        {estimatedCredits != null && (
          <p className="text-xs text-slate-500 text-right mt-1.5">
            {isApproximate ? '~' : '='} {new Intl.NumberFormat().format(estimatedCredits)} credits
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={!isValid}
        onClick={() => isValid && activeAmount && onSelect(activeAmount)}
        className="w-full py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Continue
      </button>
    </div>
  )
}
