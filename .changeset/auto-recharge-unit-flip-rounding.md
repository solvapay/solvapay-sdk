---
'@solvapay/react': patch
---

Fix lossy credit↔currency rounding when toggling auto-recharge amount units.

- **`estimateCredits`** now uses `Math.round` (matching credits→currency) instead of `Math.floor`.
- **Unit toggle** snaps back to the last user-entered value instead of re-deriving from the rounded display, so repeated flips no longer drift by a minor unit.
