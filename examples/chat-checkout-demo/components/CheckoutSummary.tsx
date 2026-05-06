import React from 'react'

interface CheckoutSummaryProps {
  title: string
  subtitle?: string
  amount: string
  currency: string
  onChange?: () => void
}

/**
 * Shared "here's what you're paying for" surface used by every checkout
 * drawer (subscription, lifetime access, top-up). Keeps the price as the visual
 * hero, with a light neutral background so the form and CTA below lead.
 *
 * Pass `onChange` to render an inline "Change" button -- replaces the
 * orphaned "Change amount" link that previously sat below the Pay CTA.
 */
export const CheckoutSummary: React.FC<CheckoutSummaryProps> = ({
  title,
  subtitle,
  amount,
  currency,
  onChange,
}) => {
  const showCurrency = currency.toUpperCase() !== 'USD'

  return (
    <div className="mb-5 p-4 bg-slate-50 rounded-lg border border-slate-200/60">
      <div className="flex justify-between items-center gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">{title}</h3>
          {subtitle && <p className="text-xs text-slate-600 mt-0.5 truncate">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-2xl font-semibold tracking-tight text-slate-900 leading-none">
              {amount}
            </div>
            {showCurrency && (
              <div className="text-[10px] text-slate-500 mt-1 uppercase">{currency}</div>
            )}
          </div>
          {onChange && (
            <button
              type="button"
              onClick={onChange}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded-md hover:bg-white/80 transition-colors"
            >
              Change
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
