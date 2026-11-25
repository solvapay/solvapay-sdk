---
'@solvapay/python': patch
'@solvapay/go': patch
---

The generated API clients follow the platform's spec, rewritten for its zod 4 upgrade. It now matches what the API accepts.

- `timestamp` on a usage event is optional; the API stamps the event when it is left out. In Go, `Timestamp` is now `*string`.
- A completed agent call's `cost` needs both `amount` and `currency`, as the API already required. In Go, both are now `string` rather than `*string`.
- A Python request model checks its values against the API's limits when it is built: email addresses, three-letter currency codes, date-times with seconds, and integers up to 2^53 - 1.
