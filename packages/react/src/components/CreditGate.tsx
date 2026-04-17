'use client'

/**
 * Default-tree shim over the `CreditGate` primitive.
 *
 * Renders `children` when the customer has enough credits, otherwise renders
 * a default top-up prompt (Heading + Subheading + Topup) or a user-provided
 * `fallback`. Full control is available via
 * `@solvapay/react/primitives` — compose `CreditGate.Root` with your own
 * subcomponent arrangement.
 */

import React from 'react'
import { CreditGate as Primitive, useCreditGate } from '../primitives/CreditGate'

export interface CreditGateProps {
  minCredits?: number
  productRef?: string
  topupAmount?: number
  topupCurrency?: string
  fallback?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

const AllowedContent: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const ctx = useCreditGate()
  if (ctx.state !== 'allowed') return null
  return <>{children}</>
}

const DefaultBlockedTree: React.FC<{ fallback?: React.ReactNode }> = ({ fallback }) => {
  const ctx = useCreditGate()
  if (ctx.state !== 'blocked') return null
  if (fallback) return <>{fallback}</>
  return (
    <>
      <Primitive.Heading className="solvapay-credit-gate-heading" />
      <Primitive.Subheading className="solvapay-credit-gate-subheading" />
      <Primitive.Topup />
    </>
  )
}

export const CreditGate: React.FC<CreditGateProps> = ({
  minCredits,
  productRef,
  topupAmount,
  topupCurrency,
  fallback,
  className,
  children,
}) => {
  const rootClass = ['solvapay-credit-gate', className].filter(Boolean).join(' ')
  return (
    <Primitive.Root
      minCredits={minCredits}
      productRef={productRef}
      topupAmount={topupAmount}
      topupCurrency={topupCurrency}
      className={rootClass}
    >
      <AllowedContent>{children}</AllowedContent>
      <DefaultBlockedTree fallback={fallback} />
    </Primitive.Root>
  )
}
