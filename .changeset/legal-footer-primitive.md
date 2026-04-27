---
'@solvapay/react': minor
---

Add a `<LegalFooter>` primitive that renders a
`Terms · Privacy / Provided by SolvaPay` strip pointing at SolvaPay's own
legal pages. Mirrors the hosted-checkout footer without bringing Chakra
into the SDK.

- New `legalFooter.{terms, privacy, providedBy, poweredBy}` keys on the
  i18n bundle, overridable via `<SolvaPayProvider config={{ copy }}>`.
- `<PaymentForm>` and `<TopupForm>` expose a `LegalFooter` namespace
  member so custom compositions can opt into the strip via
  `<PaymentForm.LegalFooter />` / `<TopupForm.LegalFooter />`.
- The drop-in `<PaymentForm>` default tree does **not** render
  `<LegalFooter />` — the strip is reserved for shell chrome (e.g.
  `<McpAppShell>`) so it isn't duplicated above the merchant's own
  layout.
- `<MandateText>` now linkifies merchant `termsUrl` / `privacyUrl`
  substrings inside the rendered sentence — they render as `<a>` tags
  labeled via `copy.legalFooter.{terms,privacy}`, so terms/privacy
  access lives at the point of charge alongside the mandate prose.
- The MCP shell footer (`<McpAppShell>`) renders `<LegalFooter>`
  unconditionally with SolvaPay's legal URLs, laid out as a single
  horizontal row (`Provided by SolvaPay` left, `Terms · Privacy`
  right) with no hairline separator above it.
