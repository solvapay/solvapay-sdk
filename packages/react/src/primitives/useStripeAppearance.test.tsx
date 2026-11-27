/**
 * The Stripe iframe cannot see the host page's colour scheme, so the hook has
 * to rebuild the appearance whenever the host switches theme. Hosts switch
 * theme in more ways than `prefers-color-scheme`: a `dark` class or a
 * `data-theme` attribute on `<html>`, `<body>` or a wrapper above the form.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStripeAppearance } from './useStripeAppearance'

const PALETTE: Record<string, string> = {
  '--solvapay-radius': '8px',
  '--solvapay-surface': 'light-dark(#FFFFFF, #171717)',
  '--solvapay-accent': 'light-dark(#000000, #E8E8E8)',
}

const HOST_THEME_CSS = `
  html { color-scheme: light; }
  html.dark, body.dark, [data-theme='dark'] { color-scheme: dark; }
`

function mountForm(parent: HTMLElement = document.body): HTMLElement {
  const style = document.createElement('style')
  style.textContent = HOST_THEME_CSS
  document.head.appendChild(style)

  const root = document.createElement('form')
  for (const [token, value] of Object.entries(PALETTE)) root.style.setProperty(token, value)
  parent.appendChild(root)
  return root
}

/** Observer callbacks run as microtasks; the rebuild waits for the next frame. */
async function flushObservers(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  })
}

describe('useStripeAppearance', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('class')
    document.documentElement.removeAttribute('data-theme')
    document.head.replaceChildren()
    document.body.removeAttribute('class')
    document.body.replaceChildren()
  })

  it('rebuilds when the host toggles a dark class on <html>', async () => {
    const root = mountForm()
    const { result } = renderHook(() => useStripeAppearance(root))
    expect(result.current?.variables?.colorBackground).toBe('rgb(255, 255, 255)')

    document.documentElement.classList.add('dark')
    await flushObservers()

    expect(result.current?.variables?.colorBackground).toBe('rgb(23, 23, 23)')
    expect(result.current?.variables?.colorText).toBe('rgb(232, 232, 232)')
  })

  it('rebuilds when the host sets data-theme on <html>', async () => {
    const root = mountForm()
    const { result } = renderHook(() => useStripeAppearance(root))

    document.documentElement.setAttribute('data-theme', 'dark')
    await flushObservers()

    expect(result.current?.variables?.colorBackground).toBe('rgb(23, 23, 23)')
  })

  it('rebuilds when the host toggles a dark class on <body>', async () => {
    const root = mountForm()
    const { result } = renderHook(() => useStripeAppearance(root))

    document.body.classList.add('dark')
    await flushObservers()

    expect(result.current?.variables?.colorBackground).toBe('rgb(23, 23, 23)')
  })

  it('rebuilds when a wrapper above the form switches theme', async () => {
    const wrapper = document.createElement('div')
    document.body.appendChild(wrapper)
    const root = mountForm(wrapper)
    const { result } = renderHook(() => useStripeAppearance(root))

    wrapper.setAttribute('data-theme', 'dark')
    await flushObservers()

    expect(result.current?.variables?.colorBackground).toBe('rgb(23, 23, 23)')

    wrapper.removeAttribute('data-theme')
    await flushObservers()

    expect(result.current?.variables?.colorBackground).toBe('rgb(255, 255, 255)')
  })

  it('keeps the same appearance object when an unrelated attribute changes', async () => {
    const root = mountForm()
    const { result } = renderHook(() => useStripeAppearance(root))
    const before = result.current

    document.body.setAttribute('data-scroll-locked', '1')
    await flushObservers()

    expect(result.current).toBe(before)
  })

  it('rebuilds once for a burst of mutations in one frame', async () => {
    const root = mountForm()
    const { result } = renderHook(() => useStripeAppearance(root))
    const before = result.current
    const appendChild = vi.spyOn(root, 'appendChild')

    for (let step = 0; step < 10; step += 1) {
      document.body.style.opacity = String(step / 10)
    }
    document.documentElement.classList.add('dark')
    await flushObservers()

    // buildStripeAppearance appends one probe per build.
    expect(appendChild).toHaveBeenCalledTimes(2)
    expect(result.current).not.toBe(before)
    expect(result.current?.variables?.colorBackground).toBe('rgb(23, 23, 23)')
    appendChild.mockRestore()
  })

  it('does not observe the host when an appearance is passed in', async () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe')
    const root = mountForm()
    const given = { theme: 'night' as const }
    const { result } = renderHook(() => useStripeAppearance(root, given))

    expect(result.current).toBe(given)
    expect(observe).not.toHaveBeenCalled()
    observe.mockRestore()
  })
})
