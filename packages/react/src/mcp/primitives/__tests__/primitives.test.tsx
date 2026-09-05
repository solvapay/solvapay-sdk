import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AmountLadder,
  AttributionFooter,
  Eyebrow,
  Field,
  LedgerRow,
  LineItem,
  Pill,
  PlanRow,
  PresetTile,
  Section,
  SplitRow,
  StatusDot,
  Toggle,
  sanitizeDecimalInput,
} from '../index'

describe('sanitizeDecimalInput', () => {
  it('turns a comma decimal into a dot and drops extra dots', () => {
    expect(sanitizeDecimalInput('10,50')).toBe('10.50')
    expect(sanitizeDecimalInput('1.2.3')).toBe('1.23')
    expect(sanitizeDecimalInput('$12')).toBe('12')
  })
})

describe('MCP primitives', () => {
  it('renders a Section heading and Eyebrow variants', () => {
    const { rerender } = render(
      <Section title="Active products">
        <Eyebrow variant="step">Step 1</Eyebrow>
      </Section>,
    )
    expect(screen.getByRole('heading', { name: 'Active products' }).className).toBe(
      'solvapay-mcp-section-title',
    )
    expect(screen.getByText('Step 1')).toHaveAttribute('data-variant', 'step')

    rerender(<Eyebrow variant="rail">Order</Eyebrow>)
    expect(screen.getByText('Order')).toHaveAttribute('data-variant', 'rail')
  })

  it('renders LineItem and AmountLadder with a muted row', () => {
    render(
      <AmountLadder
        rows={[
          { label: 'Adding', value: '500,000' },
          { label: 'Tax', value: '$0.00', muted: true },
        ]}
      />,
    )
    expect(screen.getByText('Adding').parentElement?.className).toContain('solvapay-mcp-line-item')
    expect(screen.getByText('Tax').parentElement).toHaveAttribute('data-muted', 'true')
    expect(screen.getByText('500,000').className).toBe('solvapay-mcp-line-item-value')
  })

  it('marks a selected PresetTile without dropping the credits line', () => {
    const onClick = vi.fn()
    render(<PresetTile amount="$50" credits="500K credits" selected onClick={onClick} />)
    const tile = screen.getByRole('button', { name: /\$50/ })
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    expect(tile).toHaveAttribute('data-state', 'selected')
    expect(screen.getByText('500K credits')).toBeTruthy()
    fireEvent.click(tile)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('keeps the PlanRow check slot mounted when unselected', () => {
    const { rerender } = render(
      <PlanRow name="Free" description="100 calls per month" price="$0" current />,
    )
    const row = screen.getByRole('button', { name: /Free/ })
    expect(row.querySelector('.solvapay-mcp-plan-row-check')).toBeTruthy()
    expect(row).not.toHaveAttribute('data-state')
    expect(screen.getByText('Current').className).toContain('solvapay-mcp-status-dot')

    rerender(
      <PlanRow name="Pro" description="Unlimited calls" price="$90.00" selected />,
    )
    expect(screen.getByRole('button', { name: /Pro/ })).toHaveAttribute('data-state', 'selected')
    expect(screen.getByRole('button', { name: /Pro/ }).querySelector('.solvapay-mcp-plan-row-check'))
      .toBeTruthy()
  })

  it('renders StatusDot and Pill', () => {
    render(
      <>
        <StatusDot label="Active" />
        <Pill>MCP</Pill>
      </>,
    )
    expect(screen.getByText('Active').className).toBe('solvapay-mcp-status-dot')
    expect(screen.getByText('MCP').className).toBe('solvapay-mcp-pill')
  })

  it('sanitizes decimal Field input and keeps prefix/suffix out of the border', () => {
    const onChange = vi.fn()
    render(
      <Field id="amount" label="Top up to" value="" onChange={onChange} prefix="$" suffix="USD" />,
    )
    expect(screen.getByLabelText('Top up to')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Top up to'), { target: { value: '10,50' } })
    expect(onChange).toHaveBeenCalledWith('10.50')
    expect(screen.getByText('$').className).toBe('solvapay-mcp-field-affix')
    expect(screen.getByText('USD').className).toBe('solvapay-mcp-field-affix')
  })

  it('toggles with role=switch', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} label="Auto-recharge" />)
    const toggle = screen.getByRole('switch', { name: 'Auto-recharge' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveAttribute('data-state', 'off')
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('right-aligns ledger amount cells', () => {
    render(
      <LedgerRow
        cells={[
          { content: 'Top up' },
          { content: '5 Sep' },
          { content: '+50,000', align: 'right' },
          { content: '599,800', align: 'right' },
        ]}
      />,
    )
    expect(screen.getByText('+50,000')).toHaveAttribute('data-align', 'right')
    expect(screen.getByText('Top up').parentElement?.className).toBe('solvapay-mcp-ledger-row')
  })

  it('renders AttributionFooter and SplitRow slots', () => {
    render(
      <AttributionFooter>
        <span>Provided by SolvaPay</span>
      </AttributionFooter>,
    )
    expect(screen.getByText('Provided by SolvaPay').parentElement?.className).toBe(
      'solvapay-mcp-attribution',
    )

    render(<SplitRow>side by side</SplitRow>)
    expect(screen.getByText('side by side').className).toBe('solvapay-mcp-split-row')
  })
})
