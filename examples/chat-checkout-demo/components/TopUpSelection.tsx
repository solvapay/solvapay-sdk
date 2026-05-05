import React, { useState } from 'react'
import { formatPrice, useLocale, type Plan } from '@solvapay/react'
import { TopUpSelection as TopUpSelectionType } from '../types'
import { CheckCircleIcon } from './icons/CheckCircleIcon'

interface TopUpSelectionProps {
  packs: Plan[]
  initial: TopUpSelectionType
  onContinue: (selection: TopUpSelectionType) => void
  onCancel?: () => void
}

/**
 * Pack picker for the top-up scenario.
 *
 * Each "pack" is a one-time plan on the top-up product. The plan's
 * `name` doubles as the display label (e.g. `"100 Credits"`) and
 * `price` / `currency` drive the price. Nothing about credit counts
 * or pricing is hardcoded — set it all in the SolvaPay dashboard.
 */
export const TopUpSelection: React.FC<TopUpSelectionProps> = ({
  packs,
  initial,
  onContinue,
  onCancel,
}) => {
  const locale = useLocale()
  const [planRef, setPlanRef] = useState<string>(() => initial.planRef || packs[0]?.reference || '')
  const [autoTopUpEnabled, setAutoTopUpEnabled] = useState<boolean>(initial.autoTopUpEnabled)

  const selected = packs.find(p => p.reference === planRef)

  if (packs.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Choose your top-up</h2>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
          No credit packs configured. Add one or more one-time plans to the top-up product in
          the SolvaPay dashboard, then refresh.
        </div>
        {onCancel && (
          <button onClick={onCancel} className="mt-4 w-full py-2 rounded-full border text-sm">
            Cancel
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900 mb-2">Choose your top-up</h2>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {packs.map((pack, i) => {
          const isSelected = pack.reference === planRef
          const price = formatPrice(pack.price ?? 0, pack.currency ?? 'USD', { locale })
          const isPopular = i === packs.length - 1 && packs.length > 1
          return (
            <button
              key={pack.reference}
              type="button"
              onClick={() => setPlanRef(pack.reference)}
              aria-pressed={isSelected}
              className={`relative p-4 rounded-xl border text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-300 ${
                isSelected
                  ? 'border-slate-900 bg-gradient-to-br from-white to-slate-50 shadow-sm ring-1 ring-slate-900/10'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              } hover:scale-[1.01] active:scale-[0.99]`}
            >
              {isPopular && (
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
              <div className="text-lg font-semibold tracking-tight">{price}</div>
              <div className="text-xs text-slate-500 mt-0.5">{pack.name ?? pack.reference}</div>
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
        <div className="text-base font-semibold text-slate-900">
          {selected
            ? formatPrice(selected.price ?? 0, selected.currency ?? 'USD', { locale })
            : '—'}
        </div>
      </div>

      <div className="flex gap-2">
        {onCancel && (
          <button onClick={onCancel} className="flex-1 py-2 rounded-full border text-sm">
            Cancel
          </button>
        )}
        <button
          onClick={() => planRef && onContinue({ planRef, autoTopUpEnabled })}
          disabled={!planRef}
          className="flex-1 py-2 rounded-full bg-slate-900 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
