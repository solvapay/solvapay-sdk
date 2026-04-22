/**
 * Tab-strip metadata shared between the shell and the first-run tour.
 *
 * Lives in its own file so `McpFirstRunTour.tsx` can import the hint
 * copy without pulling in `McpAppShell.tsx` (which imports the tour
 * back). A two-way edge would be a cycle.
 */

import type { McpTabKind } from './tab-kind'

export const TAB_LABELS: Record<McpTabKind, string> = {
  about: 'About',
  usage: 'Credits',
  checkout: 'Plan',
  topup: 'Top up',
  account: 'Account',
  activate: 'Activate',
}

/**
 * Tab hint copy surfaced as both the `title=` tooltip and the
 * `aria-describedby` live region for screen readers. Same strings
 * power the first-run tour — one source of truth.
 */
export const MCP_TAB_HINTS: Record<McpTabKind, string> = {
  about: 'What this app does and how to get started.',
  checkout: 'Pick, change, or cancel your plan. Free, pay-as-you-go, and paid plans all live here.',
  topup: 'Add credits without leaving the chat.',
  account: 'See your balance, usage, payment method, and seller details.',
  usage: 'Usage snapshot for the current plan.',
  activate: 'Activate a free, trial, or usage-based plan.',
}
