import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formatProvenanceLine, McpProvenanceLine } from '../McpProvenanceLine'

describe('formatProvenanceLine', () => {
  it('joins merchant and email with a middot', () => {
    expect(formatProvenanceLine('Acme', 'ada@acme.test')).toBe('Acme · Paying as ada@acme.test')
  })

  it('renders Paying as email when the merchant name is missing', () => {
    expect(formatProvenanceLine(null, 'ada@acme.test')).toBe('Paying as ada@acme.test')
  })

  it('renders the merchant alone when there is no email', () => {
    expect(formatProvenanceLine('Acme', null)).toBe('Acme')
  })

  it('returns null when both sides are empty', () => {
    expect(formatProvenanceLine('  ', null)).toBeNull()
    expect(formatProvenanceLine(null, null)).toBeNull()
  })
})

describe('<McpProvenanceLine>', () => {
  it('renders nothing when there is no identity to show', () => {
    const { container } = render(<McpProvenanceLine />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the combined provenance line', () => {
    render(<McpProvenanceLine merchantName="Acme" email="ada@acme.test" />)
    expect(screen.getByText('Acme · Paying as ada@acme.test')).toBeTruthy()
  })
})
