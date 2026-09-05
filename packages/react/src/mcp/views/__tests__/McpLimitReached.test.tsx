import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { McpLimitReached } from '../McpLimitReached'

describe('<McpLimitReached>', () => {
  it('names the product and hands off to the account', () => {
    const onOpenAccount = vi.fn()
    render(<McpLimitReached productName="Cool MCP" onOpenAccount={onOpenAccount} />)
    expect(screen.getByText('Limit reached for Cool MCP')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open account' }))
    expect(onOpenAccount).toHaveBeenCalledOnce()
  })

  it('does not invent a shortfall when the product name is unknown', () => {
    render(<McpLimitReached />)
    expect(screen.getByText('Limit reached')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open account' })).toBeNull()
    expect(screen.queryByText(/\$/)).toBeNull()
  })
})
