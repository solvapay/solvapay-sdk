---
'@solvapay/react-supabase': patch
---

Widen the `@solvapay/react` peer range to `^1.7.0 || ^2.0.0`.

This package only imports `createSessionAuthAdapter` and the `AuthAdapter` type, neither
of which changes in `@solvapay/react@2`. The previous `workspace:^` published as a
single-major caret, so the v2 release would have forced a major here (and on everything
downstream) for a break this package does not experience.
