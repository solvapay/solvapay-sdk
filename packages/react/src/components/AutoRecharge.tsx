'use client'

/**
 * Default-tree shim over the `AutoRecharge` primitive.
 *
 * Renders the golden-path auto-recharge panel consumers expect in drop-in
 * usage. For full control, compose `@solvapay/react/primitives` directly.
 */

import React from 'react'
import type { SaveAutoRechargeResponse } from '@solvapay/server'
import { AutoRecharge as Primitive } from '../primitives/AutoRecharge'

export type AutoRechargeProps = {
  currency?: string
  defaultThresholdAmountMajor?: number
  defaultTopupAmountMajor?: number
  onSetupRequired?: (result: SaveAutoRechargeResponse) => void | Promise<void>
  onSaved?: (result: SaveAutoRechargeResponse) => void | Promise<void>
  onDisabled?: () => void | Promise<void>
  className?: string
}

export function AutoRecharge({
  currency = 'USD',
  defaultThresholdAmountMajor,
  defaultTopupAmountMajor,
  onSetupRequired,
  onSaved,
  onDisabled,
  className,
}: AutoRechargeProps): React.ReactElement {
  const rootClass = ['solvapay-auto-recharge', className].filter(Boolean).join(' ')

  return (
    <Primitive.Root
      currency={currency}
      defaultThresholdAmountMajor={defaultThresholdAmountMajor}
      defaultTopupAmountMajor={defaultTopupAmountMajor}
      onSetupRequired={onSetupRequired}
      onSaved={onSaved}
      onDisabled={onDisabled}
      className={rootClass}
    >
      <Primitive.Loading className="solvapay-auto-recharge-loading" />
      <Primitive.Header className="solvapay-auto-recharge-header" />
      <Primitive.Body className="solvapay-auto-recharge-body">
        <Primitive.Summary className="solvapay-auto-recharge-summary" />
        <Primitive.ThresholdField />
        <Primitive.TopupField className="solvapay-auto-recharge-topup-field" />
        <Primitive.AdvancedToggle className="solvapay-auto-recharge-advanced-toggle" />
        <Primitive.AdvancedPanel className="solvapay-auto-recharge-advanced" />
        <Primitive.ValidationError className="solvapay-auto-recharge-validation-error" />
        <Primitive.Actions className="solvapay-auto-recharge-actions">
          <Primitive.SaveButton className="solvapay-auto-recharge-save" />
          <Primitive.DisableButton className="solvapay-auto-recharge-disable" />
        </Primitive.Actions>
      </Primitive.Body>
      <Primitive.Status className="solvapay-auto-recharge-status" />
      <Primitive.Error className="solvapay-auto-recharge-error" />
      <Primitive.StatusMessage className="solvapay-auto-recharge-status-message" />
    </Primitive.Root>
  )
}
