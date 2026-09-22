'use client'

import React from 'react'
import type { AutoRechargeFormState } from '../../../helpers/auto-recharge-form'
import { useCopy } from '../../../hooks/useCopy'
import { interpolate } from '../../../i18n/interpolate'
import { estimateCredits } from '../../../utils/credit-estimation'
import { Field } from '../../primitives'

function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0)
    return parts.find(part => part.type === 'currency')?.value ?? currency.toUpperCase()
  } catch {
    return currency.toUpperCase()
  }
}

export interface McpAutoRechargeFieldsProps {
  form: AutoRechargeFormState
  onChange: (next: AutoRechargeFormState) => void
  currency: string
  validationError?: string | null
  creditsPerMinorUnit?: number | null
  displayExchangeRate?: number | null
}

export function McpAutoRechargeFields({
  form,
  onChange,
  currency,
  validationError,
  creditsPerMinorUnit,
  displayExchangeRate,
}: McpAutoRechargeFieldsProps): React.ReactElement {
  const copy = useCopy()
  const prefix = currencySymbol(currency)
  const suffix = currency.toUpperCase()
  const credits = estimateCredits(
    Number(form.topupAmountMajor),
    currency,
    creditsPerMinorUnit,
    displayExchangeRate,
  )
  const explainer =
    credits != null
      ? interpolate(copy.autoRechargeView.explainer, {
          credits: new Intl.NumberFormat().format(credits),
        })
      : copy.autoRechargeView.explainerNoEstimate

  return (
    <div className="solvapay-mcp-auto-recharge-fields">
      <Field
        id="mcp-auto-recharge-threshold"
        label={copy.autoRechargeView.thresholdLabel}
        value={form.thresholdAmountMajor}
        prefix={prefix}
        suffix={suffix}
        onChange={thresholdAmountMajor => onChange({ ...form, thresholdAmountMajor })}
      />
      <Field
        id="mcp-auto-recharge-topup"
        label={copy.autoRechargeView.topupLabel}
        value={form.topupAmountMajor}
        prefix={prefix}
        suffix={suffix}
        onChange={topupAmountMajor => onChange({ ...form, topupAmountMajor })}
      />
      <Field
        id="mcp-auto-recharge-cap"
        label={copy.autoRechargeView.maxMonthlySpendLabel}
        value={form.maxMonthlySpendMajor}
        prefix={prefix}
        suffix={suffix}
        placeholder={copy.autoRechargeView.maxMonthlySpendPlaceholder}
        onChange={maxMonthlySpendMajor => onChange({ ...form, maxMonthlySpendMajor })}
      />
      <p className="solvapay-mcp-auto-recharge-fields-explainer">{explainer}</p>
      {validationError ? (
        <p className="solvapay-mcp-auto-recharge-fields-error" role="alert">
          {validationError}
        </p>
      ) : null}
    </div>
  )
}
