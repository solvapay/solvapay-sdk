# SDK error handling (contributors)

This page is for maintainers working on SDK internals and adapters. Errors, like
all shared behavior, originate in the Rust core and are mapped once per binding
into each language's idiomatic exception type (see [architecture.md](./architecture.md)).

## The `SdkError` model (Rust core)

`core/solvapay-core/src/error.rs` defines `SdkError`, the single
cross-language error surface. It has four kinds:

| Kind        | Meaning                                                           | Maps to (TS)                    |
| ----------- | ----------------------------------------------------------------- | ------------------------------- |
| `Api`       | Backend/API failure; carries a rendered message template + status | `SolvaPayError`                 |
| `Paywall`   | Payment required / limit exceeded; carries the full gate          | `PaywallError` (402 formatting) |
| `Webhook`   | Webhook verification failure; carries a stable `WebhookErrorCode` | `SolvaPayError`                 |
| `Transport` | Transport / I/O failure — the **only** transport error surface    | `SolvaPayError`                 |

Messages come from manifest-frozen templates (`error_templates.rs`, generated),
so wording is consistent across surfaces and stable across releases.

## One conversion layer per binding

Wrappers do **not** re-encode domain failures. Each binding maps `SdkError` once,
at the FFI/facade boundary, into the host exception type, then rethrows/rejects.
Integrators in every language see the same stable `code` vocabulary and the same
message templates; only the exception _class_ name and language idioms differ.

Panics never cross a language boundary: `catch_unwind` at every FFI edge turns a
panic into `SdkError::Transport { retryable: false }` plus a logged report.

## Stable codes and frozen templates

- **Webhook** and **transport** errors carry _stable_ codes. New codes may be
  added; existing codes and message strings must not change until a major
  version (redesign-v2 §6.4).
- Existing per-method thrown messages (§2.3) are frozen in the manifest as
  templates. Do not change a message string in a way that would alter a
  consumer's observed error; add a new template/code instead.

## Public TypeScript shapes (unchanged)

The public TS error surface is preserved — consumers still catch:

- `SolvaPayError` — base SDK error type
- `PaywallError` — payment required / limit exceeded, with structured payload

These are the host-mapped views of `SdkError`; their shapes are a compatibility
guarantee.

## Adapter behavior

- `http` adapters map paywall errors to HTTP `402`
- `next` adapters return consistent `NextResponse` error payloads
- `mcp` adapters preserve structured content for tool clients (note: a paywall
  tool result is `isError: false` — a user-actionable gate, not a tool failure)

## Design goals

- keep structured payloads stable for adapters
- return actionable details without leaking secrets
- preserve root-cause context in logs while keeping external messages concise

## Webhook verification vs replay

`verify_webhook` in `core/solvapay-core/src/webhook.rs` is signature + clock
only. It has no replay/nonce store (core purity: no HTTP, no env, no timers,
no caches). The ±300 s `timestamp_too_old` window rejects stale `SV-Signature`
headers; a retry of the same event inside that window still verifies.

Integrators must dedupe on **`event.id`** (also the `SV-Event-Id` header).
`SV-Delivery` is unique **per attempt**, so it does not prevent processing the
same event twice when SolvaPay retries.

TypeScript facades accept an optional `seenEventId` callback on
`verifyWebhook` / `solvapayWebhook`. Return `true` when the id is already
processed. The hook throws `SolvaPayError` with `code: 'duplicate_event'`;
HTTP handlers should answer **2xx** for that code so the sender stops retrying.
Do not add this store to core — keep it host-side.

## Contributor checklist

- change error behavior in the Rust core (or the manifest templates), not in a
  single facade — one conversion layer per binding
- add/adjust `contract/fixtures/` golden fixtures for new error branches and
  confirm both `pnpm test:contract` and the `fixture-runner` stay green
- never change an existing stable code or frozen message string without a major
- validate error shape across `@solvapay/server`, `@solvapay/next`, and examples
- keep user-facing copy short and deterministic

## Related docs

- [`architecture.md`](./architecture.md) — where the error model lives
- [`testing.md`](./testing.md) — fixtures and dual-impl suites
- [`rust-core-sdk-redesign-v2.md`](./rust-core-sdk-redesign-v2.md) §4.4 / §6.4 — full rationale
- `CONTRIBUTING.md`
