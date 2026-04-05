'use client'

import { useState } from 'react'

const PRESET_AMOUNTS = [
  { label: '$5', cents: 500 },
  { label: '$10', cents: 1000 },
  { label: '$25', cents: 2500 },
  { label: '$50', cents: 5000 },
]

interface AmountSelectorProps {
  onSelect: (amountCents: number) => void
  className?: string
}

export function AmountSelector({ onSelect, className }: AmountSelectorProps) {
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

  const isValid = activeAmount !== null && activeAmount > 0

  return (
    <div className={className}>
      <h3 className="text-sm font-medium text-slate-900 mb-4">Select amount</h3>

      <div className="grid grid-cols-4 gap-3 mb-4">
        {PRESET_AMOUNTS.map(({ label, cents }) => (
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
            {label}
          </button>
        ))}
      </div>

      <div className="mb-6">
        <label htmlFor="custom-amount" className="text-xs text-slate-500 mb-1 block">
          Or enter a custom amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
          <input
            id="custom-amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={customAmount}
            onFocus={handleCustomFocus}
            onChange={e => handleCustomChange(e.target.value)}
            className={`w-full pl-7 pr-4 py-2.5 rounded-lg border text-sm transition-colors ${
              isCustom
                ? 'border-slate-900 ring-1 ring-slate-900'
                : 'border-slate-200'
            } focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900`}
          />
        </div>
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
