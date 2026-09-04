import React from 'react'
import { useCustomer } from '@solvapay/react'
import { IdentityStrip } from './IdentityStrip'
import { truncateRef } from '../src/lib/truncateRef'

/**
 * Header strip rendered at the top of every checkout drawer (subscription,
 * lifetime access, top-up). Mirrors the chrome of a native payment sheet:
 * merchant on the left, buyer identity on the right.
 */
export const DrawerHeader: React.FC = () => {
  const { customerRef } = useCustomer()

  return (
    <div className="flex items-center justify-between gap-3 pb-3 mb-4 border-b border-slate-100">
      <IdentityStrip compact />
      {customerRef && (
        <div className="text-[11px] text-slate-500 text-right shrink-0">
          <div className="text-slate-400">Paying as</div>
          <div className="font-mono text-slate-700">{truncateRef(customerRef)}</div>
        </div>
      )}
    </div>
  )
}
