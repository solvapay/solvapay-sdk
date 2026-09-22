/**
 * External-link routing.
 *
 * The contract these tests pin down is asymmetric on purpose:
 *
 *   - With no opener in scope, the SDK must NOT call `preventDefault()`.
 *     Suppressing native navigation on a host that can't open links
 *     itself would turn a working link into a dead one.
 *   - With an opener in scope, it must always `preventDefault()` and
 *     delegate, because that's the only path out of a sandboxed iframe
 *     whose `sandbox` attribute omits `allow-popups`.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import React from 'react'
import {
  ExternalLinkProvider,
  useExternalLinkClick,
  useOpenExternal,
  type ExternalLinkOpener,
} from './useExternalLink'

function LinkProbe({
  href = 'https://portal.solvapay.test/abc',
  omitHref = false,
  preventFirst = false,
}: {
  href?: string
  /** Render without an `href` to exercise the "no resolved href" guard. */
  omitHref?: boolean
  /** Simulate a consumer handler that already claimed the click. */
  preventFirst?: boolean
}) {
  const handleExternalClick = useExternalLinkClick()
  return (
    <a
      {...(omitHref ? {} : { href })}
      target="_blank"
      rel="noopener noreferrer"
      onClick={event => {
        if (preventFirst) event.preventDefault()
        handleExternalClick(event)
      }}
    >
      open portal
    </a>
  )
}

function ImperativeProbe({ url }: { url: string }) {
  const openExternal = useOpenExternal()
  const [result, setResult] = React.useState<string>('')
  return (
    <>
      <button
        type="button"
        data-testid="open"
        onClick={() => void openExternal(url).then(ok => setResult(String(ok)))}
      >
        open
      </button>
      <span data-testid="result">{result}</span>
    </>
  )
}

function buildOpener(overrides: Partial<ExternalLinkOpener> = {}): ExternalLinkOpener {
  return {
    canOpen: () => true,
    open: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useExternalLinkClick', () => {
  it('leaves native navigation alone with no opener mounted', () => {
    render(<LinkProbe />)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(screen.getByRole('link'), event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves native navigation alone when the host cannot open links', () => {
    const opener = buildOpener({ canOpen: () => false })
    render(
      <ExternalLinkProvider opener={opener}>
        <LinkProbe />
      </ExternalLinkProvider>,
    )
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(screen.getByRole('link'), event)
    expect(event.defaultPrevented).toBe(false)
    expect(opener.open).not.toHaveBeenCalled()
  })

  it('suppresses navigation and hands the href to the host when it can open links', () => {
    const opener = buildOpener()
    render(
      <ExternalLinkProvider opener={opener}>
        <LinkProbe />
      </ExternalLinkProvider>,
    )
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(screen.getByRole('link'), event)
    expect(event.defaultPrevented).toBe(true)
    expect(opener.open).toHaveBeenCalledWith('https://portal.solvapay.test/abc')
  })

  it('warns instead of failing silently when the host declines', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const opener = buildOpener({ open: vi.fn().mockResolvedValue(false) })
    render(
      <ExternalLinkProvider opener={opener}>
        <LinkProbe />
      </ExternalLinkProvider>,
    )
    fireEvent.click(screen.getByRole('link'))
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(warn.mock.calls[0][0]).toContain('https://portal.solvapay.test/abc')
  })

  it('does not intercept a click a consumer handler already claimed', () => {
    const opener = buildOpener()
    render(
      <ExternalLinkProvider opener={opener}>
        <LinkProbe preventFirst />
      </ExternalLinkProvider>,
    )
    fireEvent.click(screen.getByRole('link'))
    expect(opener.open).not.toHaveBeenCalled()
  })

  // `asChild` consumers can render a non-anchor, which leaves no
  // resolved `href` to hand over. The handler must fall through rather
  // than pass the host an empty URL.
  it('never hands the host a click with no resolved href', () => {
    const opener = buildOpener()
    render(
      <ExternalLinkProvider opener={opener}>
        <LinkProbe omitHref />
      </ExternalLinkProvider>,
    )
    fireEvent.click(screen.getByText('open portal'))
    expect(opener.open).not.toHaveBeenCalled()
  })
})

describe('useOpenExternal', () => {
  it('falls back to window.open with no opener mounted', async () => {
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<ImperativeProbe url="https://portal.solvapay.test/late" />)
    fireEvent.click(screen.getByTestId('open'))
    await vi.waitFor(() => expect(screen.getByTestId('result').textContent).toBe('true'))
    expect(windowOpen).toHaveBeenCalledWith(
      'https://portal.solvapay.test/late',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('prefers the host opener and never touches window.open', async () => {
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
    const opener = buildOpener()
    render(
      <ExternalLinkProvider opener={opener}>
        <ImperativeProbe url="https://portal.solvapay.test/late" />
      </ExternalLinkProvider>,
    )
    fireEvent.click(screen.getByTestId('open'))
    await vi.waitFor(() => expect(screen.getByTestId('result').textContent).toBe('true'))
    expect(opener.open).toHaveBeenCalledWith('https://portal.solvapay.test/late')
    expect(windowOpen).not.toHaveBeenCalled()
  })

  it('reports false when the host declines, so callers can surface the dead end', async () => {
    const opener = buildOpener({ open: vi.fn().mockResolvedValue(false) })
    render(
      <ExternalLinkProvider opener={opener}>
        <ImperativeProbe url="https://portal.solvapay.test/late" />
      </ExternalLinkProvider>,
    )
    fireEvent.click(screen.getByTestId('open'))
    await vi.waitFor(() => expect(screen.getByTestId('result').textContent).toBe('false'))
  })
})
