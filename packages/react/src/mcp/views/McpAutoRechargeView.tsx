'use client'

/**
 * `<McpAutoRechargeView>` — dedicated auto-recharge setting surface.
 *
 * Reached from the account panel when a reusable card is on file.
 * No card collection, no amount tiles, no total. Two modes off
 * `config?.enabled`: turn-on and edit.
 */

import React, { useEffect, useState } from 'react'
import {
  buildSummaryLine,
  configToForm,
  createDefaultAutoRechargeForm,
  formatAmountWithUnit,
  validateAutoRechargeForm,
  type AutoRechargeFormState,
} from '../../helpers/auto-recharge-form'
import { useAutoRecharge } from '../../hooks/useAutoRecharge'
import { useBalance } from '../../hooks/useBalance'
import { useCopy } from '../../hooks/useCopy'
import { useMerchant } from '../../hooks/useMerchant'
import { interpolate } from '../../i18n/interpolate'
import { Section, StatusDot } from '../primitives'
import { BackLink } from './BackLink'
import { McpAutoRechargeFields } from './autoRecharge/McpAutoRechargeFields'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

const FALLBACK_CURRENCY = 'USD'

export interface McpAutoRechargeViewProps {
  classNames?: McpViewClassNames
  /** Wired by the shell to return to the account surface. */
  onBack?: () => void
}

function resolveCurrency(
  displayCurrency: string | null | undefined,
  merchantCurrency: string | undefined,
): string {
  if (displayCurrency) return displayCurrency.toUpperCase()
  if (merchantCurrency) return merchantCurrency.toUpperCase()
  return FALLBACK_CURRENCY
}

export function McpAutoRechargeView({ classNames, onBack }: McpAutoRechargeViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const { merchant, loading: merchantLoading } = useMerchant()
  const { displayCurrency, creditsPerMinorUnit, displayExchangeRate } = useBalance()
  const { config, loading, saving, disabling, error, save, disable } = useAutoRecharge()
  const currency = resolveCurrency(displayCurrency, merchant?.defaultCurrency)
  const conversion = { creditsPerMinorUnit, displayExchangeRate }

  const [form, setForm] = useState<AutoRechargeFormState>(() => ({
    ...createDefaultAutoRechargeForm(currency),
    enabled: true,
  }))
  const [hydrated, setHydrated] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)

  useEffect(() => {
    if (loading || hydrated) return
    if (config?.enabled) {
      setForm({ ...configToForm(config, currency), enabled: true })
    }
    setHydrated(true)
  }, [loading, config, currency, hydrated])

  const editing = Boolean(config?.enabled)
  const summary = buildSummaryLine(form, currency)
  const thresholdDisplay = formatAmountWithUnit(
    form.thresholdAmountMajor,
    form.thresholdUnit,
    currency,
  )

  if (loading || merchantLoading) {
    return (
      <section className={cx.card} aria-label="Loading auto-recharge">
        <p>Loading auto-recharge…</p>
      </section>
    )
  }

  const handleSave = async () => {
    const result = validateAutoRechargeForm(
      { ...form, enabled: true },
      currency,
      conversion,
      copy.autoRecharge,
    )
    if (!result.ok) {
      setValidationError(result.error)
      return
    }
    setValidationError(null)
    setSetupError(null)
    try {
      const response = await save(result.payload)
      if (response.setupClientSecret) {
        setSetupError(copy.autoRechargeView.setupUnexpected)
        return
      }
      onBack?.()
    } catch {
      // `useAutoRecharge` already stashes the error for the alert.
    }
  }

  const handleDisable = async () => {
    setSetupError(null)
    try {
      await disable()
      onBack?.()
    } catch {
      // `useAutoRecharge` already stashes the error for the alert.
    }
  }

  const loudError = setupError ?? (error ? error.message : null)

  return (
    <section className={cx.card} aria-label={copy.autoRechargeView.heading}>
      <div className="solvapay-mcp-auto-recharge-view">
        {onBack ? <BackLink label={copy.autoRechargeView.back} onClick={onBack} /> : null}
        <div className={cx.stack}>
          <div className="solvapay-mcp-auto-recharge-heading">
            <h2 className={cx.heading}>{copy.autoRechargeView.heading}</h2>
            {editing ? <StatusDot label={copy.autoRechargeView.statusOn} /> : null}
          </div>
          {editing ? null : <p className={cx.muted}>{copy.autoRechargeView.description}</p>}
          {summary ? <p className="solvapay-mcp-auto-recharge-summary">{summary}</p> : null}
        </div>
        <Section>
          <McpAutoRechargeFields
            form={form}
            onChange={next => {
              setValidationError(null)
              setForm(next)
            }}
            currency={currency}
            validationError={validationError}
            creditsPerMinorUnit={creditsPerMinorUnit}
            displayExchangeRate={displayExchangeRate}
          />
        </Section>
        {loudError ? (
          <p className={cx.error} role="alert">
            {loudError}
          </p>
        ) : null}
        {editing ? (
          <div className="solvapay-mcp-auto-recharge-actions-stack">
            <button
              type="button"
              className={cx.button}
              disabled={saving || disabling}
              onClick={() => {
                void handleSave()
              }}
            >
              {copy.autoRechargeView.save}
            </button>
            <button
              type="button"
              className={cx.button}
              data-variant="secondary"
              disabled={saving || disabling}
              onClick={onBack}
            >
              {copy.autoRechargeView.cancel}
            </button>
            <button
              type="button"
              className={`${cx.linkButton} solvapay-mcp-auto-recharge-turn-off`.trim()}
              disabled={saving || disabling}
              onClick={() => {
                void handleDisable()
              }}
            >
              {copy.autoRechargeView.turnOff}
            </button>
          </div>
        ) : (
          <div className="solvapay-mcp-auto-recharge-footer">
            <p className={cx.muted}>
              {interpolate(copy.autoRechargeView.footerCaption, {
                threshold: thresholdDisplay,
              })}
            </p>
            <div className="solvapay-mcp-auto-recharge-actions">
              <button
                type="button"
                className={cx.button}
                data-variant="secondary"
                disabled={saving}
                onClick={onBack}
              >
                {copy.autoRechargeView.cancel}
              </button>
              <button
                type="button"
                className={cx.button}
                disabled={saving}
                onClick={() => {
                  void handleSave()
                }}
              >
                {copy.autoRechargeView.turnOn}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
