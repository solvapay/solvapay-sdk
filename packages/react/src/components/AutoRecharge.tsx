'use client'

import { FormEvent, ReactElement, useState } from 'react'
import type { SaveAutoRechargeResponse } from '@solvapay/server'
import { useAutoRecharge } from '../hooks/useAutoRecharge'

export type AutoRechargeProps = {
  currency?: string
  defaultThresholdAmountMajor?: number
  defaultTopupAmountMajor?: number
  onSetupRequired?: (result: SaveAutoRechargeResponse) => void | Promise<void>
  onSaved?: (result: SaveAutoRechargeResponse) => void | Promise<void>
  onDisabled?: () => void | Promise<void>
}

export function AutoRecharge({
  currency = 'USD',
  defaultThresholdAmountMajor = 5,
  defaultTopupAmountMajor = 10,
  onSetupRequired,
  onSaved,
  onDisabled,
}: AutoRechargeProps): ReactElement {
  const autoRecharge = useAutoRecharge()
  const [enabled, setEnabled] = useState(true)
  const [thresholdAmountMajor, setThresholdAmountMajor] = useState(
    String(defaultThresholdAmountMajor),
  )
  const [topupAmountMajor, setTopupAmountMajor] = useState(String(defaultTopupAmountMajor))
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatusMessage(null)
    const result = await autoRecharge.save({
      enabled,
      triggerType: 'balance',
      thresholdAmountMajor: Number(thresholdAmountMajor),
      topupMode: 'fixed',
      topupAmountMajor: Number(topupAmountMajor),
      currency,
    })

    if (result.setupClientSecret) {
      setStatusMessage('Confirm your card to activate automatic top-ups.')
      await onSetupRequired?.(result)
      return
    }

    setStatusMessage('Automatic top-up settings saved.')
    await onSaved?.(result)
  }

  const disable = async () => {
    await autoRecharge.disable()
    setStatusMessage('Automatic top-ups disabled.')
    await onDisabled?.()
  }

  return (
    <section aria-label="Automatic credit top-up">
      <form onSubmit={submit}>
        <fieldset disabled={autoRecharge.saving || autoRecharge.disabling}>
          <legend>Automatic credit top-up</legend>

          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={event => setEnabled(event.currentTarget.checked)}
            />
            Enable automatic top-ups
          </label>

          <label>
            When balance falls below
            <input
              type="number"
              min="0"
              step="0.01"
              value={thresholdAmountMajor}
              onChange={event => setThresholdAmountMajor(event.currentTarget.value)}
            />
          </label>

          <label>
            Add this amount
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={topupAmountMajor}
              onChange={event => setTopupAmountMajor(event.currentTarget.value)}
            />
          </label>

          <button type="submit">Save automatic top-up</button>
          {autoRecharge.config ? (
            <button type="button" onClick={disable}>
              Disable automatic top-up
            </button>
          ) : null}
        </fieldset>
      </form>

      {autoRecharge.error ? (
        <p role="alert" aria-live="polite">
          {autoRecharge.error.message}
        </p>
      ) : null}
      {statusMessage ? <p aria-live="polite">{statusMessage}</p> : null}
    </section>
  )
}
