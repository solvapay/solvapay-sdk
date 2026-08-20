---
'@solvapay/react-supabase': patch
---

Republish so the `@preview` dist-tag tracks the current family. It was left on `2.0.0-preview-2c722a7c` from a false-major cascade that never shipped to `@latest` (`1.0.10`). That snapshot peers `@solvapay/react@^2.0.0-preview-2c722a7c`, so `npm install @solvapay/react@preview @solvapay/react-supabase@preview` cannot resolve against `react@1.7.0-preview`.
