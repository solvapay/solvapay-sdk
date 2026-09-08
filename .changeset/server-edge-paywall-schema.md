---
'@solvapay/server': minor
---

`PaywallStructuredContentSchema` is now derived from the Rust-core JSON Schema (`paywallStructuredContentSchema`) and is exported from both the Node and edge bundles so `@solvapay/mcp` can import it on Cloudflare Workers.

The public binding is a lazy Zod type (`z.lazy`) rather than a `ZodDiscriminatedUnion`. `z.infer<typeof PaywallStructuredContentSchema>` still describes the same gate object, but `shortMessage` is required on both branches to match core. A new `paywallStructuredContentSchema()` helper returns that JSON Schema.
