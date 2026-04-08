'use client'

import type { UseTopupAmountSelectorReturn } from '@solvapay/react'
import { Button } from '../../components/ui/Button'

interface TopupAmountPickerProps extends UseTopupAmountSelectorReturn {
  creditsPerUnit?: number
  onContinue: () => void
  submitting?: boolean
}

export function TopupAmountPicker({
  quickAmounts,
  selectedAmount,
  customAmount,
  resolvedAmount,
  selectQuickAmount,
  setCustomAmount,
  error,
  currencySymbol,
  creditsPerUnit,
  onContinue,
  submitting,
}: TopupAmountPickerProps) {
  const resolvedAmountMinor =
    resolvedAmount != null && resolvedAmount > 0 ? Math.round(resolvedAmount * 100) : null
  const estimatedUnits =
    creditsPerUnit != null && creditsPerUnit > 0 && resolvedAmountMinor != null
      ? Math.floor(resolvedAmountMinor / creditsPerUnit)
      : null

  return (
    <div className="space-y-5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        Select an amount
      </p>

      <div className="flex flex-wrap gap-2">
        {quickAmounts.map(amount => (
          <button
            key={amount}
            type="button"
            onClick={() => selectQuickAmount(amount)}
            className={`px-5 py-2 rounded-full text-sm font-semibold border transition-all ${
              selectedAmount === amount && !customAmount
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:border-slate-900'
            }`}
          >
            {currencySymbol}{amount.toLocaleString()}
          </button>
        ))}
      </div>

      <div
        className={`transition-opacity duration-150 ${
          selectedAmount != null && !customAmount ? 'opacity-45' : 'opacity-100'
        }`}
      >
        <p className="text-sm font-medium text-slate-500 mb-2">Or enter a custom amount</p>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none">
            {currencySymbol}
          </span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={customAmount}
            onChange={e => setCustomAmount(e.target.value)}
            onFocus={() => {
              if (selectedAmount != null) selectQuickAmount(0)
            }}
            className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg text-slate-900 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 outline-none transition-colors"
          />
        </div>
      </div>

      {estimatedUnits != null && (
        <p className="text-sm text-slate-500">
          &asymp; {estimatedUnits.toLocaleString()} units
        </p>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button
        variant="action"
        type="button"
        onClick={onContinue}
        disabled={!resolvedAmount || resolvedAmount < 1 || submitting}
      >
        Continue to payment
      </Button>
    </div>
  )
}
