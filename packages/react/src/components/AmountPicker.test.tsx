import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React, { createRef } from 'react'
import { AmountPicker as ShimAmountPicker } from './AmountPicker'
import { AmountPicker, useAmountPicker } from '../primitives/AmountPicker'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'

function renderShim(props: Partial<React.ComponentProps<typeof ShimAmountPicker>> = {}) {
  return render(
    <SolvaPayProvider config={{}}>
      <ShimAmountPicker currency="usd" {...props} />
    </SolvaPayProvider>,
  )
}

describe('AmountPicker (default-tree shim)', () => {
  it('renders default label, quick-amount pills and custom input', () => {
    renderShim()
    expect(screen.getByText('Select an amount')).toBeTruthy()
    expect(screen.getByText('Or enter a custom amount')).toBeTruthy()
    expect(screen.getByText('$10')).toBeTruthy()
    expect(screen.getByText('$500')).toBeTruthy()
    expect(screen.getByPlaceholderText('0.00')).toBeTruthy()
  })

  it('selects a quick amount and fires onChange', async () => {
    const onChange = vi.fn()
    renderShim({ onChange })
    fireEvent.click(screen.getByText('$50'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(50))
  })

  it('custom input is mutually exclusive with pill selection', async () => {
    const onChange = vi.fn()
    renderShim({ onChange })
    fireEvent.click(screen.getByText('$10'))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(10))
    const input = screen.getByPlaceholderText('0.00') as HTMLInputElement
    fireEvent.change(input, { target: { value: '25' } })
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(25))
  })
})

describe('AmountPicker primitive', () => {
  it('Option emits data-state idle → selected when clicked', async () => {
    render(
      <SolvaPayProvider config={{}}>
        <AmountPicker.Root currency="usd">
          <AmountPicker.Option amount={10} data-testid="pill-10" />
          <AmountPicker.Option amount={50} data-testid="pill-50" />
        </AmountPicker.Root>
      </SolvaPayProvider>,
    )
    expect(screen.getByTestId('pill-10').getAttribute('data-state')).toBe('idle')
    fireEvent.click(screen.getByTestId('pill-10'))
    await waitFor(() =>
      expect(screen.getByTestId('pill-10').getAttribute('data-state')).toBe('selected'),
    )
    expect(screen.getByTestId('pill-50').getAttribute('data-state')).toBe('idle')
  })

  it('Option asChild swaps shell + chains handlers', async () => {
    const consumerClick = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    render(
      <SolvaPayProvider config={{}}>
        <AmountPicker.Root currency="usd">
          <AmountPicker.Option asChild amount={50} data-testid="pill">
            <button ref={ref} onClick={consumerClick}>
              Half a hundred
            </button>
          </AmountPicker.Option>
        </AmountPicker.Root>
      </SolvaPayProvider>,
    )
    const pill = screen.getByTestId('pill')
    expect(pill.textContent).toBe('Half a hundred')
    expect(ref.current).toBe(pill)
    fireEvent.click(pill)
    await waitFor(() => expect(pill.getAttribute('data-state')).toBe('selected'))
    expect(consumerClick).toHaveBeenCalled()
  })

  it('useAmountPicker exposes hook state for custom layouts', () => {
    const Custom = () => {
      const { quickAmounts, currencySymbol } = useAmountPicker()
      return (
        <div>
          <span data-testid="symbol">{currencySymbol}</span>
          <span data-testid="count">{quickAmounts.length}</span>
        </div>
      )
    }
    render(
      <SolvaPayProvider config={{}}>
        <AmountPicker.Root currency="usd">
          <Custom />
        </AmountPicker.Root>
      </SolvaPayProvider>,
    )
    expect(screen.getByTestId('symbol').textContent).toBe('$')
    expect(screen.getByTestId('count').textContent).toBe('4')
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <AmountPicker.Root currency="usd">
          <AmountPicker.Option amount={10} />
        </AmountPicker.Root>,
      ),
    ).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})
