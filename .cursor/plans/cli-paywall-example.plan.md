---
name: cli-paywall-example
overview: Ship a worked example showing how to add SolvaPay paywalls to a pipe-friendly CLI built for AI agents that shell out via Bash. Introduces versioned paywall envelope schemas and a SettlementAdapter interface in @solvapay/core to keep the gate/estimate/settlement contract stable as additional payment methods are added later. Two enabling SDK changes (SolvapayPkceClient in @solvapay/auth, intentToolNames option in @solvapay/server). Ships as an example, not a published package.
todos:
  - id: backend-dcr-prereq
    content: "Prerequisite: verify /v1/customer/auth/register accepts token_endpoint_auth_method: 'none' for PKCE public clients; coordinate backend change if needed"
    status: pending
  - id: core-envelopes
    content: "Add versioned envelope Zod schemas to @solvapay/core: PaywallGateEnvelopeV1, EstimateEnvelopeV1, SettlementEnvelopeV1, with a payment[] discriminated union so additional payment methods can be added without breaking parsers"
    status: pending
  - id: core-settlement-adapter
    content: "Add SettlementAdapter interface to @solvapay/core (quote, authorize, settle); ship CreditsSettlementAdapter as first implementation; add an interface-only stub (NotImplementedError) for a second adapter to validate the interface accommodates wallet-signed payment flows"
    status: pending
  - id: auth-pkce-client
    content: Add SolvapayPkceClient to @solvapay/auth (createPkce, registerDynamic, authorizeUrl, exchangeWithVerifier, refresh, revoke) with unit tests mocking fetch
    status: pending
  - id: intent-tool-names
    content: Add intentToolNames option to buildGateMessage in @solvapay/server (non-breaking, default unchanged); snapshot tests for MCP default + CLI override
    status: pending
  - id: example-scaffold
    content: "Scaffold examples/cli-paywall-app: package.json (bin: extract-cli), tsup, .env.example, bootstrap.ts using bootstrapPaygProduct"
    status: pending
  - id: example-output-modes
    content: "Implement output.ts + gate.ts: mode detection (TTY / NO_COLOR / --gate-format / env), stdout/stderr discipline, human chalk vs JSON-on-stderr using @solvapay/core's PaywallGateEnvelopeV1"
    status: pending
  - id: example-auth-tty
    content: "Implement TTY-gated login: SolvapayPkceClient + localhost callback server + browser handoff; refuse to login from pipe and emit a JSON gate envelope explaining how the developer should run login"
    status: pending
  - id: example-credentials
    content: "Implement credentials store: XDG-aware ~/.config/solvapay/credentials.json with chmod 600 on POSIX; Windows warning + plaintext fallback; .lock sentinel for refresh serialisation"
    status: pending
  - id: example-with-paywall
    content: "Implement local withPaywall helper: load creds -> resolve customerRef via userinfo -> paywall.decide() routed through CreditsSettlementAdapter -> handler+trackUsage or emit gate per mode"
    status: pending
  - id: example-commands
    content: "Implement commands: extract (paid, reads stdin, writes stdout), balance (JSON stdout), topup (URL stdout), login/logout/whoami; --estimate flag returning a parseable quote"
    status: pending
  - id: example-settlement-receipt
    content: "Emit SettlementEnvelopeV1 on stderr after each paid call (used, balance_after); optional fields reserved so additional settlement methods can extend the receipt without breaking parsers"
    status: pending
  - id: example-readme
    content: "Write README with two walkthroughs: human flow and agent-pipeline flow (find | xargs extract-cli with mid-pipeline gate + retry)"
    status: pending
  - id: tests
    content: "vitest coverage: envelope schemas roundtrip, PKCE happy path (mocked fetch), credentials store roundtrip, withPaywall allow/gate branches via CreditsSettlementAdapter, output-mode detection table, gate/settlement envelope snapshots (human + JSON)"
    status: pending
  - id: changeset
    content: "Add changesets for @solvapay/core (envelopes + SettlementAdapter), @solvapay/auth (PKCE), @solvapay/server (intentToolNames); update SDK root README with link to the new example"
    status: pending
isProject: false
---

## Background

CLI tools called from agent shells (Claude Code, Cursor, Codex, gemini-cli) compose into pipelines via the agent's `Bash` tool: `find ... | extract-cli | jq ...`. These pipelines run atomically without LLM round-trips between stages, local files stay local, output streams through `jq`/`awk`/`tee`, and the tools work in cron and CI. MCP doesn't cover this surface cleanly because tool calls are one-at-a-time JSON-args/JSON-result.

A paid CLI in that environment needs to behave like a Unix citizen and stay compatible with structured-output consumers at the same time: stdout sacred for data, stderr for paywall, structured gate envelopes the agent can parse and chain to a topup, plus pre-flight cost estimation.

Shipped as an example, not a published `@solvapay/cli-sdk` package. If real merchants adopt the pattern, package extraction is mechanical.

## Scope: in vs out

**In:**
- `@solvapay/core`: versioned envelope Zod schemas + `SettlementAdapter` interface + `CreditsSettlementAdapter` + a stub second adapter to validate the interface shape
- `@solvapay/auth`: `SolvapayPkceClient` (PKCE primitives + DCR helper). The MCP bridge example reimplements PKCE inline today in [examples/mcp-oauth-bridge/scripts/run-oauth-flow.ts](examples/mcp-oauth-bridge/scripts/run-oauth-flow.ts); lifting it into `@solvapay/auth` avoids duplication.
- `@solvapay/server`: `intentToolNames` option on [`buildGateMessage`](packages/server/src/paywall-state.ts) -- non-breaking, default keeps MCP names; serves any non-MCP transport that wants to substitute its own tool names in the gate copy
- `examples/cli-paywall-app` -- a pipe-friendly paid CLI (`extract-cli`-shaped) with three operating modes (human / agent / pre-flight) consuming the new core envelopes + adapter
- Backend confirmation: `/v1/customer/auth/register` accepts `token_endpoint_auth_method: 'none'` for PKCE public clients

**Out:**
- New `@solvapay/cli-sdk` published package
- Opinionated `createSolvaPayCli` builder
- Cross-platform keychain (file with `chmod 600` on POSIX; Windows out of scope for v1)
- Interactive retry loops
- Browser-handshake fallback
- Actual second-adapter implementation (interface-only stub here; build is a follow-up PR)

## The pipe-friendly contract (three modes)

Mode auto-detected from TTY + env; explicit overrides via `--gate-format` or `SOLVAPAY_GATE_FORMAT`.

### Human mode (stdout is TTY, no `NO_COLOR`)

```
$ extract-cli < scan.pdf
You're out of credits.
Run `extract-cli topup` to add more, or pay at https://checkout.solvapay.com/...
[exit 2]
```

Chalk colors on stderr only. Stdout untouched.

### Agent mode (stdout is a pipe, or `--gate-format=json`)

Emits a `PaywallGateEnvelopeV1` on stderr (NDJSON-shaped, one line):

```json
{
  "envelope": "solvapay_gate_v1",
  "state": "topup_required",
  "message": "Out of credits",
  "intent": "topup",
  "payment": [
    { "method": "credits", "checkoutUrl": "https://checkout.solvapay.com/...", "amount": 5, "currency": "USD" }
  ]
}
```

Exit 2. The consumer matches `envelope: 'solvapay_gate_v1'`, parses, surfaces the URL, retries.

The `payment[]` array is a discriminated union so additional methods can be appended without breaking older parsers:

```json
"payment": [
  { "method": "credits", "checkoutUrl": "https://...", "amount": 5, "currency": "USD" },
  { "method": "<future-method>", "...": "..." }
]
```

### Pre-flight (`--check` / `balance` / `--estimate`)

```bash
$ extract-cli --estimate < scan.pdf
{
  "envelope": "solvapay_estimate_v1",
  "estimated_credits": 3,
  "balance": 1280,
  "currency": "USD"
}

$ extract-cli balance
{
  "envelope": "solvapay_balance_v1",
  "balance": 1280,
  "remaining": null,
  "plan": "payg-usage"
}
```

Agents budgeting before a `find ... | xargs extract-cli` fan-out.

### Settlement receipt (post-success, stderr)

After every successful paid call:

```json
{"envelope":"solvapay_settlement_v1","used":3,"balance_after":1277}
```

Optional extension fields (`authorized`, `asset`, `tx`, `facilitator`) are reserved in the schema for future settlement methods. Optional output (`SOLVAPAY_RECEIPT=off` to suppress); on by default in agent mode.

## Architecture

```mermaid
flowchart LR
  Agent["Coding agent (Bash tool)"] -->|pipeline| Pipe["find ... | extract-cli | jq"]
  Pipe --> CLI["extract-cli (commander)"]
  CLI -->|withPaywall| Decide["solvaPay.paywall.decide()"]
  Decide --> Adapter{"SettlementAdapter"}
  Adapter -->|today| Credits["CreditsSettlementAdapter"]
  Adapter -.->|stub| Second["second adapter (interface only)"]
  Credits -->|allow| Handler["Merchant logic (stdin -> stdout)"]
  Handler --> Track["trackUsage(used)"]
  Track --> Receipt["SettlementEnvelopeV1 on stderr"]
  Credits -->|gate| Mode{"output mode"}
  Mode -->|TTY| Human["chalk stderr, exit 2"]
  Mode -->|pipe| Json["PaywallGateEnvelopeV1 JSON, exit 2"]
  CLI -.->|login (TTY only)| OAuth["SolvapayPkceClient + localhost callback"]
  OAuth --> Creds["~/.config/solvapay/credentials.json"]
```

## Implementation

### 1. `@solvapay/core`: envelope schemas + `SettlementAdapter`

Add Zod schemas + adapter interface:

```ts
export const PaywallGateEnvelopeV1 = z.object({
  envelope: z.literal('solvapay_gate_v1'),
  state: z.enum(['topup_required', 'upgrade_required', 'activation_required', 'reactivation_required']),
  message: z.string(),
  intent: z.string(),
  payment: z.array(PaymentOptionV1).min(1),
})

export const PaymentOptionV1 = z.discriminatedUnion('method', [
  CreditsPaymentOptionV1, // { method: 'credits', checkoutUrl, amount, currency }
  // Additional method schemas added here as they ship.
])

export const EstimateEnvelopeV1 = z.object({
  envelope: z.literal('solvapay_estimate_v1'),
  estimated_credits: z.number(),
  balance: z.number().nullable(),
  currency: z.string(),
})

export const SettlementEnvelopeV1 = z.object({
  envelope: z.literal('solvapay_settlement_v1'),
  used: z.union([z.number(), z.string()]),
  balance_after: z.number().optional(),
  authorized: z.union([z.number(), z.string()]).optional(),
  asset: z.string().optional(),
  tx: z.string().optional(),
  facilitator: z.string().optional(),
})

export interface SettlementAdapter {
  readonly method: string
  quote(input: QuoteInput): Promise<PaymentOption>
  authorize(input: AuthorizeInput): Promise<AuthHandle>
  settle(input: SettleInput): Promise<SettlementReceipt>
}

export class CreditsSettlementAdapter implements SettlementAdapter { /* wraps existing paywall.decide+trackUsage */ }
```

Stabilising envelope shapes (versioned, Zod-validated) before a second payment method ships avoids breaking parsers later. Cheaper to design the discriminated union once than to migrate consumers.

A second adapter is shipped as an interface-only stub (`throws NotImplementedError`) to validate the interface accommodates wallet-signed payment flows. No business logic.

### 2. `@solvapay/auth`: `SolvapayPkceClient`

Extend [packages/auth/src/solvapay.ts](packages/auth/src/solvapay.ts) with a public-client OAuth helper. The existing `SolvapayOAuthClient` has no PKCE support and `exchangeCodeForToken` doesn't accept a `code_verifier`.

```ts
export class SolvapayPkceClient {
  constructor(config: { apiBaseUrl: string; clientId?: string })

  createPkce(): { codeVerifier: string; codeChallenge: string }
  registerDynamic(opts: { clientName: string; redirectUri: string; productRef?: string }): Promise<{ clientId: string }>
  authorizeUrl(opts: { clientId: string; redirectUri: string; codeChallenge: string; state: string; productRef?: string }): string
  exchangeWithVerifier(opts: { code: string; codeVerifier: string; clientId: string; redirectUri: string }): Promise<TokenResponse>
  refresh(opts: { refreshToken: string; clientId: string }): Promise<TokenResponse>
  revoke(opts: { token: string; clientId: string }): Promise<void>
}
```

Same `/v1/customer/auth/*` endpoints the [MCP OAuth bridge](packages/mcp-core/src/oauth-bridge.ts) uses; `token_endpoint_auth_method: 'none'` for public clients.

### 3. `@solvapay/server`: `intentToolNames` on `buildGateMessage`

[packages/server/src/paywall-state.ts](packages/server/src/paywall-state.ts), `buildGateMessage` currently hardcodes `upgrade` / `topup` / `activate_plan`. Make injectable, default unchanged:

```ts
export function buildGateMessage(
  state: PaywallState,
  gate: PaywallStructuredContent,
  options?: { intentToolNames?: Partial<Record<PaywallState['kind'], string>> },
): string
```

CLI example passes `{ topup_required: 'extract-cli topup', upgrade_required: 'extract-cli upgrade' }`. MCP default behaviour unchanged. Non-breaking.

### 4. `examples/cli-paywall-app`

```
examples/cli-paywall-app/
  src/
    cli.ts                  # commander program, mode detection, command wiring
    output.ts               # mode detection (TTY, NO_COLOR, --gate-format), stdout/stderr discipline
    gate.ts                 # build & emit PaywallGateEnvelopeV1 (human chalk or JSON)
    with-paywall.ts         # local helper: load creds -> resolve customerRef -> CreditsSettlementAdapter -> handler+trackUsage or emit gate
    auth/
      login.ts              # TTY-gated PKCE flow via SolvapayPkceClient
      credentials.ts        # XDG-aware file store, chmod 600 (POSIX)
      userinfo.ts           # access_token -> customerRef (cached)
    commands/
      extract.ts            # paid: reads stdin, calls demo handler, writes stdout
      balance.ts            # JSON on stdout, exit 0
      topup.ts              # createTopupPaymentIntent -> print URL (stdout) -> exit 0
      login.ts / logout.ts / whoami.ts
  bootstrap.ts              # createSolvaPay().bootstrapPaygProduct(...) one-shot
  package.json              # bin: extract-cli
  README.md                 # walkthrough including the agent-pipeline example
  .env.example
```

Built on raw `commander` + `@solvapay/server` + `@solvapay/core`'s adapter + `@solvapay/auth`'s new PKCE client. No new SDK abstractions in the example -- the example *is* the abstraction. ~400 lines total target.

### Key invariants the example enforces

- **stdout is sacred.** No chalk, no progress, no banners. Only data -- JSON for parseable subcommands, raw bytes for the paid handler.
- **All UX on stderr.** Login flow logs, gate envelopes, settlement receipts.
- **TTY-only login.** `extract-cli login` checks `process.stdin.isTTY && process.stdout.isTTY`. In a pipe, it errors with a gate envelope on stderr telling the agent to instruct its user to run login separately.
- **Mode detection precedence**: explicit `--gate-format=json|text` -> `SOLVAPAY_GATE_FORMAT` env -> `NO_COLOR` env -> `process.stdout.isTTY`.
- **Concurrent invocations.** Credentials read is a simple read; refresh-on-401 uses a `.lock` sentinel file to serialise (lo-fi, sufficient for v1).

### README narrative

Two walkthroughs:

1. **Human walkthrough**: install -> `extract-cli login` -> `extract-cli < file.pdf` -> out of credits -> topup -> retry.
2. **Agent walkthrough**: developer pre-authenticates -> opens an agent shell -> asks to summarise PDFs in a directory -> agent constructs `find ~/scans -name '*.pdf' | xargs -I {} extract-cli --estimate {}` to budget -> runs the real pipeline -> agent parses a JSON gate mid-flight, surfaces the URL, retries.

## Cross-cutting

1. **Backend DCR -- blocking question.** Confirm `/v1/customer/auth/register` accepts `token_endpoint_auth_method: 'none'`. If no, this is a backend addition before anything else lands.

2. **No changes to protected payment files** ([protected-files.mdc](.cursor/rules/protected-files.mdc)).

3. **Skills routing.** Add a brief mention in [skills/skills/solvapay/sdk-integration/](skills/skills/solvapay/sdk-integration/) once shipped; full new domain guide can wait until adoption is observable.

4. **SDK README.** Add a line in [Packages](README.md) referring to the new example.

## Risk register

| Risk | Mitigation |
|--|--|
| Backend doesn't support public PKCE clients | Verify before any other work; small backend PR if needed |
| Windows users | Documented gap; example logs a warning and stores plaintext on Windows v1 |
| Concurrent CLI invocations racing on refresh | `.lock` sentinel; document the limit |
| Envelope shape gets baked in too soon | Versioned (`solvapay_gate_v1` etc.); `payment[]` is a discriminated union so methods are additive; older parsers ignore unknown methods. Zod schemas in `@solvapay/core` define exactly one canonical version per envelope. |
| Long tail of DCR'd public clients on the backend | Reuse `clientId` across machines for the same user (cached in credentials file); document as known limitation otherwise |

## Out of scope (explicit)

- Published `@solvapay/cli-sdk` package
- Opinionated `createSolvaPayCli` builder
- OS keychain integration
- Windows-native credential storage
- Browser-handshake fallback
- Interactive `Top up now? [Y/n]` loops
- Refactoring existing `solvapay` CLI (`packages/cli`)
- Implementation of any settlement adapter beyond `CreditsSettlementAdapter`
