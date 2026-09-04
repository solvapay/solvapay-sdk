import React from 'react'
import { useMerchant } from '@solvapay/react'
import { BotIcon } from './icons/BotIcon'

interface IdentityStripProps {
  /** Optional fallback shown while merchant data is loading or missing. */
  fallbackName?: string
  /** Optional fallback subline (e.g. "Example end-user chat"). */
  fallbackSubline?: string
  /** Slot rendered next to the merchant name (e.g. status pill + info tooltip). */
  trailing?: React.ReactNode
  /** Compact mode for tight headers — hides the subline. */
  compact?: boolean
  className?: string
}

/**
 * Shows merchant identity (logo + display name + optional "Sold by" subline)
 * so buyers can see who they're transacting with. Pulls data from
 * `useMerchant()` and falls back gracefully when nothing is loaded yet.
 */
export const IdentityStrip: React.FC<IdentityStripProps> = ({
  fallbackName = 'Agent Chat',
  fallbackSubline,
  trailing,
  compact = false,
  className,
}) => {
  const { merchant } = useMerchant()

  const displayName = merchant?.displayName || fallbackName
  const showSoldBy =
    merchant?.legalName && merchant.legalName !== merchant.displayName
      ? `Sold by ${merchant.legalName}`
      : null
  const subline = compact ? null : (showSoldBy ?? fallbackSubline)

  return (
    <div className={`flex items-center gap-3 min-w-0 ${className ?? ''}`}>
      <div className="h-8 w-8 rounded-lg overflow-hidden flex items-center justify-center bg-slate-100 border border-slate-200/60 shrink-0">
        {merchant?.logoUrl ? (
          <img
            src={merchant.logoUrl}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <BotIcon className="h-4 w-4 text-slate-600" />
        )}
      </div>
      <div className="leading-tight min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-slate-900 tracking-tight truncate">
            {displayName}
          </h1>
          {trailing}
        </div>
        {subline && <p className="text-xs text-slate-500 truncate">{subline}</p>}
      </div>
    </div>
  )
}
