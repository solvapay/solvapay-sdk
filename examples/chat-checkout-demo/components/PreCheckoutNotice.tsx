import React from 'react'
import { SparklesIcon } from './icons/SparklesIcon'

interface PreCheckoutNoticeProps {
  /** Click handler for the CTA — flips the drawer to the embedded checkout stage. */
  onUnlock: () => void
}

/**
 * Inline pre-checkout notice strip. The educational moment between
 * hitting a 402 and opening the full embedded checkout: a generic
 * "Free limit reached / Upgrade to continue" framing with a single
 * CTA. Click flips `<InlineCheckout>` from `stage: 'notice'` to
 * `stage: 'checkout'`, mounting `<PaywallNotice.EmbeddedCheckout>`
 * where the user sees the plan grid, picks a plan, and commits.
 *
 * Intentionally generic across all scenarios. Plan-specific
 * disclosure (price, billing cycle, plan name) lives on the
 * downstream plan step, which is the canonical commit moment.
 *
 * Demo-only — the SDK's `<PaywallNotice>` doesn't gate
 * `EmbeddedCheckout` behind a click since that's a consumer UX
 * choice.
 */
export const PreCheckoutNotice: React.FC<PreCheckoutNoticeProps> = ({ onUnlock }) => (
  <div className="px-4 py-4">
    <div className="max-w-2xl mx-auto flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200/60 flex items-center justify-center">
          <SparklesIcon className="h-4 w-4 text-slate-700" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-900 leading-tight">
            Free limit reached
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">Upgrade to continue.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onUnlock}
        className="px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-full hover:bg-slate-800 transition-colors group flex items-center space-x-2"
      >
        <span>Upgrade</span>
        <svg
          className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M13 7l5 5m0 0l-5 5m5-5H6"
          />
        </svg>
      </button>
    </div>
  </div>
)
