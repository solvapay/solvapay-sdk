'use client'

import React, { forwardRef, useImperativeHandle, useState } from 'react'
import type { AutoRechargeInput } from '@solvapay/server'
import {
  createDefaultAutoRechargeForm,
  validateAutoRechargeForm,
} from '../../../helpers/auto-recharge-form'
import { useCopy } from '../../../hooks/useCopy'
import { SplitRow, Toggle } from '../../primitives'
import { McpAutoRechargeFields } from './McpAutoRechargeFields'

export type McpInlineAutoRechargeResult =
  | { ok: true; payload?: AutoRechargeInput }
  | { ok: false }

export type McpInlineAutoRechargeHandle = {
  validate: () => McpInlineAutoRechargeResult
}

export interface McpInlineAutoRechargeProps {
  currency: string
  creditsPerMinorUnit?: number | null
  displayExchangeRate?: number | null
}

export const McpInlineAutoRecharge = forwardRef<
  McpInlineAutoRechargeHandle,
  McpInlineAutoRechargeProps
>(function McpInlineAutoRecharge(
  { currency, creditsPerMinorUnit, displayExchangeRate },
  ref,
): React.ReactElement {
  const copy = useCopy()
  const [form, setForm] = useState(() => createDefaultAutoRechargeForm(currency))
  const [error, setError] = useState<string | null>(null)

  useImperativeHandle(ref, () => ({
    validate: () => {
      const result = validateAutoRechargeForm(
        form,
        currency,
        { creditsPerMinorUnit, displayExchangeRate },
        copy.autoRecharge,
      )
      if (!result.ok) {
        setError(result.error)
        return { ok: false }
      }
      setError(null)
      return {
        ok: true,
        payload: result.payload.enabled ? result.payload : undefined,
      }
    },
  }))

  return (
    <div className="solvapay-mcp-auto-recharge-inline">
      <SplitRow>
        <p>{copy.autoRechargeView.heading}</p>
        <Toggle
          checked={form.enabled}
          label={copy.autoRechargeView.heading}
          onChange={enabled => {
            setError(null)
            setForm(current => ({ ...current, enabled }))
          }}
        />
      </SplitRow>
      {form.enabled ? (
        <McpAutoRechargeFields
          form={form}
          onChange={next => {
            setError(null)
            setForm(next)
          }}
          currency={currency}
          validationError={error}
          creditsPerMinorUnit={creditsPerMinorUnit}
          displayExchangeRate={displayExchangeRate}
        />
      ) : null}
    </div>
  )
})
