import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AmountLadder,
  AttributionFooter,
  Eyebrow,
  FactBand,
  Field,
  LedgerRow,
  Pill,
  PlanRow,
  PresetTile,
  Section,
  SplitRow,
  StatusDot,
  StatusPill,
  Toggle,
  sanitizeDecimalInput,
  statusPillTone,
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
        <StatusDot label="No plan" empty />
        <Pill>MCP</Pill>
      </>,
    )
    expect(screen.getByText('Active').className).toBe('solvapay-mcp-status-dot')
    expect(screen.getByText('No plan')).toHaveAttribute('data-empty', '')
    expect(screen.getByText('MCP').className).toBe('solvapay-mcp-pill')
  })

  it('reserves StatusPill accent for D, F and I', () => {
    expect(statusPillTone('D')).toBe('accent')
    expect(statusPillTone('F')).toBe('accent')
    expect(statusPillTone('I')).toBe('accent')
    expect(statusPillTone('E')).toBe('neutral')
    expect(statusPillTone('B')).toBe('neutral')
    expect(statusPillTone('H')).toBe('neutral')
  })

  it('marks an accent StatusPill and leaves a neutral pill unaccented', () => {
    const { rerender } = render(<StatusPill tone="accent">Calls failing</StatusPill>)
    const accent = screen.getByText('Calls failing')
    expect(accent.className).toContain('solvapay-mcp-status-pill')
    expect(accent).toHaveAttribute('data-tone', 'accent')

    rerender(<StatusPill>Active</StatusPill>)
    expect(screen.getByText('Active')).toHaveAttribute('data-tone', 'neutral')
  })

  it('renders FactBand items and drops omitted facts instead of a placeholder column', () => {
    const { rerender } = render(
      <FactBand
        items={[
          { key: 'remaining', label: 'Remaining', value: '3,800 calls', caption: 'Of 10,000 this period.' },
          { key: 'renews', label: 'Renews', value: 'Sep 12, 2026', caption: 'In 6 days.' },
          { key: 'credits', label: 'Credits', value: 'Not used', caption: 'Balance is untouched.' },
        ]}
      />,
    )
    const band = screen.getByText('Remaining').closest('.solvapay-mcp-fact-band')
    expect(band?.className).toContain('solvapay-mcp-fact-band')
    expect(band?.querySelectorAll('.solvapay-mcp-fact-band-item')).toHaveLength(3)
    expect(screen.getByText('Of 10,000 this period.').className).toBe(
      'solvapay-mcp-fact-band-caption',
    )

    rerender(
      <FactBand
        items={[
          { key: 'renews', label: 'Renews', value: 'Sep 12, 2026' },
          { key: 'credits', label: 'Credits', value: 'Not used' },
        ]}
      />,
    )
    const unmetered = screen.getByText('Renews').closest('.solvapay-mcp-fact-band')
    expect(unmetered?.querySelectorAll('.solvapay-mcp-fact-band-item')).toHaveLength(2)
    expect(screen.queryByText('Remaining')).toBeNull()
    expect(screen.queryByText('Unlimited')).toBeNull()
  })

  it('keeps a compact FactBand value for the row layout', () => {
    render(
      <FactBand
        items={[
          {
            key: 'remaining',
            label: 'Remaining',
            value: '3,800 calls',
            compactValue: '3,800 of 10,000 calls',
            caption: 'Of 10,000 this period.',
          },
        ]}
      />,
    )
    expect(screen.getByText('3,800 of 10,000 calls').className).toBe(
      'solvapay-mcp-fact-band-compact',
    )
    expect(screen.getByText('3,800 calls').className).toBe('solvapay-mcp-fact-band-value')
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
