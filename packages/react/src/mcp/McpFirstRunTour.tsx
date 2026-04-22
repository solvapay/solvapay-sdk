'use client'

/**
 * `<McpFirstRunTour>` — three-step popover overlay introducing the
 * shell's tabs on first launch.
 *
 * Gate: `localStorage['solvapay-mcp-tour-seen']`. When the flag is
 * unset and the shell isn't a paywall take-over, the tour fires
 * automatically after the first render. A small `?` button in the
 * header lets the user replay it any time.
 *
 * Anchoring: each step queries a `[data-tour-step="<tab>"]` element
 * in the DOM (the tab buttons expose this attribute via
 * `McpTabBar`). The popover positions itself below the anchor; if
 * the anchor is missing (e.g. the tab isn't visible), the step is
 * skipped.
 *
 * Accessibility: the popover is a `role="dialog"` with a focus-trap,
 * Escape dismisses, Enter/Space advances. Background stays
 * interactive so users can still click through the shell — the tour
 * is informational, not modal.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { McpTabKind } from './tab-kind'
import { MCP_TAB_HINTS } from './tab-metadata'

const STORAGE_KEY = 'solvapay-mcp-tour-seen'

export interface TourStep {
  /** Which tab the step anchors to — must match `data-tour-step`. */
  anchor: McpTabKind
  /** Optional title (defaults to the tab label). */
  title?: string
  /** Body copy shown in the popover; defaults to `MCP_TAB_HINTS[anchor]`. */
  body?: string
}

export const DEFAULT_TOUR_STEPS: TourStep[] = [
  { anchor: 'about', title: 'About', body: MCP_TAB_HINTS.about },
  { anchor: 'checkout', title: 'Plan', body: MCP_TAB_HINTS.checkout },
  { anchor: 'account', title: 'Account', body: MCP_TAB_HINTS.account },
]

export interface McpFirstRunTourProps {
  /** Override the default 3-step tour (e.g. add a Top up step for PAYG products). */
  steps?: TourStep[]
  /** Persist dismissal across sessions. Defaults to `true`. */
  persist?: boolean
  /** Force-show the tour even when the localStorage flag is set. */
  forceOpen?: boolean
  /** Called when the tour closes (either dismissed or completed). */
  onClose?: (reason: 'completed' | 'dismissed') => void
}

/**
 * Check the tour gate without mounting the component. Server-safe
 * (returns `true` when `window` is undefined so SSR doesn't flicker).
 */
export function hasSeenTour(storage: Storage | null | undefined = undefined): boolean {
  const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
  if (!s) return true
  try {
    return s.getItem(STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

/** Clear the dismissal flag so the tour fires again on the next mount. */
export function resetTourDismissal(storage: Storage | null | undefined = undefined): void {
  const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
  if (!s) return
  try {
    s.removeItem(STORAGE_KEY)
  } catch {
    /* best-effort. */
  }
}

export function McpFirstRunTour({
  steps = DEFAULT_TOUR_STEPS,
  persist = true,
  forceOpen = false,
  onClose,
}: McpFirstRunTourProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [open, setOpen] = useState(forceOpen || !hasSeenTour())
  const popoverRef = useRef<HTMLDivElement | null>(null)

  const close = useCallback(
    (reason: 'completed' | 'dismissed') => {
      setOpen(false)
      if (persist && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STORAGE_KEY, '1')
        } catch {
          /* best-effort. */
        }
      }
      onClose?.(reason)
    },
    [persist, onClose],
  )

  // Filter to steps with a rendered anchor. Skipping absent anchors
  // keeps the tour robust when a tab is hidden (e.g. Top up on a
  // pure-recurring product).
  const visibleSteps = useMemo(() => {
    if (typeof document === 'undefined') return steps
    return steps.filter((s) => document.querySelector(`[data-tour-step="${s.anchor}"]`))
  }, [steps])

  useEffect(() => {
    if (!open) return
    if (stepIndex >= visibleSteps.length) {
      close('completed')
    }
  }, [open, stepIndex, visibleSteps.length, close])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close('dismissed')
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setStepIndex((i) => i + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const step = visibleSteps[stepIndex]
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    if (!open || !step) {
      setAnchorRect(null)
      return
    }
    const el = document.querySelector(`[data-tour-step="${step.anchor}"]`)
    if (el) setAnchorRect(el.getBoundingClientRect())
  }, [open, step])

  useEffect(() => {
    if (!open || !step) return
    // Focus the popover so keyboard users can advance/dismiss
    // without hunting for it.
    popoverRef.current?.focus()
  }, [open, step])

  if (!open || !step || !anchorRect) return null

  const top = anchorRect.bottom + 8
  const left = anchorRect.left
  const title = step.title ?? step.anchor
  const body = step.body ?? MCP_TAB_HINTS[step.anchor]

  return (
    <div
      className="solvapay-mcp-tour-overlay"
      role="presentation"
      data-testid="solvapay-mcp-tour"
    >
      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="solvapay-mcp-tour-title"
        tabIndex={-1}
        className="solvapay-mcp-tour-popover"
        style={{ top, left }}
      >
        <h3 id="solvapay-mcp-tour-title" className="solvapay-mcp-tour-title">
          {title}
        </h3>
        <p className="solvapay-mcp-tour-body">{body}</p>
        <div className="solvapay-mcp-tour-actions">
          <button
            type="button"
            className="solvapay-mcp-tour-skip"
            onClick={() => close('dismissed')}
          >
            Skip tour
          </button>
          <span className="solvapay-mcp-tour-progress">
            {stepIndex + 1} / {visibleSteps.length}
          </span>
          <button
            type="button"
            className="solvapay-mcp-tour-next"
            onClick={() =>
              stepIndex + 1 >= visibleSteps.length
                ? close('completed')
                : setStepIndex(stepIndex + 1)
            }
          >
            {stepIndex + 1 >= visibleSteps.length ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * `<TourReplayButton>` — small `?` button typically mounted in the
 * shell header. Calls `resetTourDismissal()` + triggers the tour to
 * re-open on next render.
 */
export function TourReplayButton({
  onReplay,
  className,
  label = 'Replay tour',
}: {
  onReplay: () => void
  className?: string
  label?: string
}) {
  return (
    <button
      type="button"
      className={['solvapay-mcp-tour-replay', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      onClick={() => {
        resetTourDismissal()
        onReplay()
      }}
    >
      ?
    </button>
  )
}
