import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { AmountPicker } from './AmountPicker'
import { SolvaPayProvider } from '../SolvaPayProvider'

function renderPicker(props: Partial<React.ComponentProps<typeof AmountPicker>> = {}) {
  return render(
    <SolvaPayProvider config={{}}>
      <AmountPicker currency="usd" {...props} />
    </SolvaPayProvider>,
  )
}

describe('AmountPicker', () => {
  it('renders default label, quick-amount pills and custom input', () => {
    renderPicker()
    expect(screen.getByText('Select an amount')).toBeTruthy()
    expect(screen.getByText('Or enter a custom amount')).toBeTruthy()
    expect(screen.getByText('$10')).toBeTruthy()
    expect(screen.getByText('$500')).toBeTruthy()
    expect(screen.getByPlaceholderText('0.00')).toBeTruthy()
  })

  it('selects a quick amount and fires onChange', async () => {
    const onChange = vi.fn()
    renderPicker({ onChange })
    fireEvent.click(screen.getByText('$50'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(50))
  })

  it('custom input is mutually exclusive with pill selection', async () => {
    const onChange = vi.fn()
    renderPicker({ onChange })
    fireEvent.click(screen.getByText('$10'))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(10))
    const input = screen.getByPlaceholderText('0.00') as HTMLInputElement
    fireEvent.change(input, { target: { value: '25' } })
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(25))
  })

  it('function-child exposes validate() which surfaces below-min errors', async () => {
    const validateRef: { current: (() => boolean) | null } = { current: null }
    renderPicker({
      minAmount: 5,
      children: ({ validate, setCustomAmount, error }) => {
        validateRef.current = validate
        return (
          <div>
            <input
              data-testid="ci"
              value=""
              onChange={e => setCustomAmount(e.target.value)}
            />
            {error && <span role="alert">{error}</span>}
          </div>
        )
      },
    })
    // Set below-min via the exposed input
    fireEvent.change(screen.getByTestId('ci'), { target: { value: '1' } })
    // Call validate imperatively through the render-prop hook reference
    expect(validateRef.current?.()).toBe(false)
  })

  it('function-child receives the hook return value', () => {
    renderPicker({
      children: ({ quickAmounts, currencySymbol }) => (
        <div>
          <span data-testid="symbol">{currencySymbol}</span>
          <span data-testid="pill-count">{quickAmounts.length}</span>
        </div>
      ),
    })
    expect(screen.getByTestId('symbol').textContent).toBe('$')
    expect(screen.getByTestId('pill-count').textContent).toBe('4')
  })

  it('honours classNames overrides', () => {
    renderPicker({
      classNames: { pill: 'my-pill', customInput: 'my-input' },
    })
    expect(screen.getAllByText(/\$\d/).some(n => n.className.includes('my-pill'))).toBe(true)
    const input = screen.getByPlaceholderText('0.00')
    expect(input.className).toContain('my-input')
  })
})
