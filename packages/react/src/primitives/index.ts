/**
 * @solvapay/react/primitives
 *
 * Unstyled, compound primitives with `asChild` composition, `data-state`
 * attributes, and opaque `data-solvapay-*` selectors. Consumer apps use
 * these to build fully custom checkout UIs; the default tree at
 * `@solvapay/react` is a thin shim over these primitives.
 *
 * Primitive entries (Root + subcomponents) are added as they land in
 * subsequent PRs.
 */

export { Slot, Slottable } from './slot'
export { composeRefs, setRef } from './composeRefs'
export { composeEventHandlers } from './composeEventHandlers'
