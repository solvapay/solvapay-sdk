import { render, screen, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import {
  McpFirstRunTour,
  hasSeenTour,
  resetTourDismissal,
  TourReplayButton,
} from '../McpFirstRunTour'

const STORAGE_KEY = 'solvapay-mcp-tour-seen'

function seedAnchors() {
  const tablist = document.createElement('div')
  tablist.innerHTML = `
    <button data-tour-step="about">About</button>
    <button data-tour-step="checkout">Plan</button>
    <button data-tour-step="account">Account</button>
  `
  document.body.appendChild(tablist)
}

describe('hasSeenTour', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns false when the flag is not set', () => {
    expect(hasSeenTour()).toBe(false)
  })

  it('returns true when the flag is set', () => {
    window.localStorage.setItem(STORAGE_KEY, '1')
    expect(hasSeenTour()).toBe(true)
  })
})

describe('resetTourDismissal', () => {
  it('clears the flag', () => {
    window.localStorage.setItem(STORAGE_KEY, '1')
    resetTourDismissal()
    expect(hasSeenTour()).toBe(false)
  })
})

describe('<McpFirstRunTour>', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.body.innerHTML = ''
  })

  it('renders the first step when the localStorage flag is unset', () => {
    seedAnchors()
    render(<McpFirstRunTour />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain('About')
  })

  it('does not render when the flag is set', () => {
    window.localStorage.setItem(STORAGE_KEY, '1')
    seedAnchors()
    render(<McpFirstRunTour />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders anyway when forceOpen=true', () => {
    window.localStorage.setItem(STORAGE_KEY, '1')
    seedAnchors()
    render(<McpFirstRunTour forceOpen />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('advances through steps and persists dismissal on completion', () => {
    seedAnchors()
    render(<McpFirstRunTour />)
    const nextBtn = screen.getByRole('button', { name: /next|done/i })
    act(() => {
      fireEvent.click(nextBtn)
    })
    // Second step
    expect(screen.getByRole('dialog').textContent).toContain('Plan')
    // Advance again
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /next|done/i }))
    })
    expect(screen.getByRole('dialog').textContent).toContain('Account')
    // Finish
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /done/i }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('skips steps whose anchor is missing', () => {
    // Only render the About anchor
    const div = document.createElement('div')
    div.innerHTML = `<button data-tour-step="about">About</button>`
    document.body.appendChild(div)

    render(<McpFirstRunTour />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('About')
    expect(dialog.textContent).toContain('1 / 1')
  })
})

describe('<TourReplayButton>', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('clears the dismissal flag when clicked', () => {
    window.localStorage.setItem(STORAGE_KEY, '1')
    const onReplay = () => {
      /* noop */
    }
    render(<TourReplayButton onReplay={onReplay} />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /replay tour/i }))
    })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
