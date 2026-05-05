import React, { useState } from 'react'
import { TopUpAmount, TopUpSelection as TopUpSelectionType } from '../types'
import { CheckCircleIcon } from './icons/CheckCircleIcon'

const priceFor = (amount: TopUpAmount) => (amount === 100 ? 2.0 : 4.0)

interface TopUpSelectionProps {
  initial: TopUpSelectionType
  onContinue: (selection: TopUpSelectionType) => void
  onCancel?: () => void
}

export const TopUpSelection: React.FC<TopUpSelectionProps> = ({
  initial,
  onContinue,
  onCancel,
}) => {
  const [amount, setAmount] = useState<TopUpAmount>(initial.amount)
  const [autoTopUpEnabled, setAutoTopUpEnabled] = useState<boolean>(initial.autoTopUpEnabled)

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900 mb-2">Choose your top-up</h2>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {[100, 200].map(a => {
          const isSelected = amount === a
          return (
            <button
              key={a}
              type="button"
              onClick={() => setAmount(a as TopUpAmount)}
              aria-pressed={isSelected}
              className={`relative p-4 rounded-xl border text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-300 ${
                isSelected
                  ? 'border-slate-900 bg-gradient-to-br from-white to-slate-50 shadow-sm ring-1 ring-slate-900/10'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              } hover:scale-[1.01] active:scale-[0.99]`}
            >
              {a === 200 && (
                <span
                  className={`absolute -top-2 left-3 px-2 py-0.5 text-[10px] font-medium rounded-full border ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-700 shadow'
                      : 'bg-blue-50 text-blue-700 border-blue-200'
                  }`}
                >
                  Popular
                </span>
              )}
              {isSelected && (
                <span className="absolute top-2 right-2 text-emerald-600">
                  <CheckCircleIcon className="h-5 w-5" />
                </span>
              )}
              <div className="text-lg font-semibold tracking-tight">
                ${priceFor(a as TopUpAmount).toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{a} Credits</div>
            </button>
          )
        })}
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-700">Auto top-up monthly</span>
          <button
            type="button"
            role="switch"
            aria-checked={autoTopUpEnabled}
            onClick={() => setAutoTopUpEnabled(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300 ${
              autoTopUpEnabled ? 'bg-slate-900' : 'bg-slate-200'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                autoTopUpEnabled ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          UI-only in this demo. Auto-top-up is not yet wired to the SolvaPay API.
        </p>
      </div>

      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-slate-600">Total</div>
        <div className="text-base font-semibold text-slate-900">${priceFor(amount).toFixed(2)}</div>
      </div>

      <div className="flex gap-2">
        {onCancel && (
          <button onClick={onCancel} className="flex-1 py-2 rounded-full border text-sm">
            Cancel
          </button>
        )}
        <button
          onClick={() => onContinue({ amount, autoTopUpEnabled })}
          className="flex-1 py-2 rounded-full bg-slate-900 text-white text-sm"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
