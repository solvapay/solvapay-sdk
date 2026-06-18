'use client'

/**
 * Default-tree shim over the `AutoRecharge` primitive.
 *
 * Renders a summary card with a trigger that opens a modal dialog for
 * configuring automatic credit top-up. For full control, compose
 * `@solvapay/react/primitives` directly.
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
  deferCardSetup?: boolean
  onPendingConfig?: (
    payload: import('../helpers/auto-recharge-form').AutoRechargeInputPayload,
  ) => void | Promise<void>
  className?: string
}

export function AutoRecharge({
  currency = 'USD',
  defaultThresholdAmountMajor,
  defaultTopupAmountMajor,
  onSetupRequired,
  onSaved,
  onDisabled,
  deferCardSetup,
  onPendingConfig,
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
      deferCardSetup={deferCardSetup}
      onPendingConfig={onPendingConfig}
      className={rootClass}
    >
      <Primitive.Loading className="solvapay-auto-recharge-loading" />
      <Primitive.Card className="solvapay-auto-recharge-card">
        <Primitive.CardHeading className="solvapay-auto-recharge-card-heading" />
        <Primitive.CardSummary className="solvapay-auto-recharge-card-summary" />
        <Primitive.Status className="solvapay-auto-recharge-status" />
        <Primitive.Trigger className="solvapay-auto-recharge-trigger" />
      </Primitive.Card>
      <Primitive.Error className="solvapay-auto-recharge-error" />
      <Primitive.Content className="solvapay-auto-recharge-content">
        <Primitive.Title className="solvapay-auto-recharge-title" />
        <Primitive.EnableQuestion className="solvapay-auto-recharge-question" />
        <Primitive.EnableRow className="solvapay-auto-recharge-enable-row" />
        <Primitive.Fields className="solvapay-auto-recharge-fields">
          <Primitive.ThresholdField />
          <Primitive.TopupField className="solvapay-auto-recharge-topup-field" />
          <Primitive.ValidationError className="solvapay-auto-recharge-validation-error" />
        </Primitive.Fields>
        <Primitive.Setup />
        <Primitive.Actions className="solvapay-auto-recharge-actions">
          <Primitive.CancelButton className="solvapay-auto-recharge-cancel" />
          <Primitive.SaveButton className="solvapay-auto-recharge-save" />
        </Primitive.Actions>
        <Primitive.StatusMessage className="solvapay-auto-recharge-status-message" />
      </Primitive.Content>
    </Primitive.Root>
  )
}
