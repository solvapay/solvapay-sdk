import React, { useEffect, useRef, useState } from 'react'
import { UserIcon } from './icons/UserIcon'
import { resetAnonymousCustomerRef, truncateRef } from '../src/lib/anonymousCustomer'

interface CustomerChipProps {
  customerRef: string | undefined
  /** Called after the persisted ref is cleared — typically to reload the page. */
  onReset?: () => void
}

/**
 * Compact chip showing the demo's anonymous customer identity. Click to
 * open a popover with the full ref and a "Reset identity" action that
 * clears localStorage and reloads — making the demo's "switch user"
 * affordance discoverable.
 */
export const CustomerChip: React.FC<CustomerChipProps> = ({ customerRef, onReset }) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  if (!customerRef) return null

  const handleReset = () => {
    resetAnonymousCustomerRef()
    setOpen(false)
    if (onReset) {
      onReset()
    } else if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded-full bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200/70 transition-colors"
      >
        <UserIcon className="h-3 w-3" />
        <span className="font-mono">{truncateRef(customerRef)}</span>
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute right-0 mt-2 z-30 w-72 rounded-lg border border-slate-200 bg-white shadow-lg p-3 text-xs"
        >
          <div className="text-slate-500 mb-1">Signed in as (demo)</div>
          <div className="font-mono text-slate-900 break-all bg-slate-50 border border-slate-200 rounded px-2 py-1.5 mb-2">
            {customerRef}
          </div>
          <p className="text-slate-500 leading-relaxed mb-3">
            Anonymous browser-bound identity. The SolvaPay backend dedupes by this ref so reloads
            preserve your purchases and balance.
          </p>
          <button
            type="button"
            onClick={handleReset}
            className="w-full text-center py-1.5 rounded-md text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            Reset identity
          </button>
        </div>
      )}
    </div>
  )
}
