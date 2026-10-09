# Opper clone

A stand-in for Opper's Anthropic-compatible API (`/v3/compat`), run by SolvaPay for the agent payments proof of concept. It forwards each call to the real Opper API with a key minted for that user in SolvaPay's Opper organisation, and streams the answer back unchanged. Claude Code cannot tell it from Opper.

Calls made with the clone's own merchant keys pass through unbilled. Calls made with a SolvaPay agent token are billed to the agent's customer at the cost Opper reports (S4). Mandates, `decide()` and agent-safe 402 and 422 arrive in later slices.

## Run it

```bash
cp .env.example .env              # fill in OPPER_MANAGEMENT_KEY and CLONE_KEY_ENCRYPTION_KEY
pnpm merchant-key alice "Alice"   # prints a toy merchant key for user alice
pnpm dev                          # listens on PORT (3040)
```

Then point Claude Code at it with the printed key:

```bash
ANTHROPIC_BASE_URL=http://localhost:3040/v3/compat ANTHROPIC_API_KEY=op-clone-... claude -p "say hi"
```

On the first call for a user, the clone creates Opper project `sp-<userRef>` and one runtime key, and stores the key encrypted in `data/kv.json`. Each call logs one `call.completed` line with the user, project, status, bytes, `X-Opper-Cost` and every `x-opper-*` response header.

## Agent tokens (S2)

A caller can present a SolvaPay agent token instead of a merchant key: an ES256 JWT from SolvaPay's agent service, verified against `SOLVAPAY_AGENT_JWKS_URL`, with `iss` = `SOLVAPAY_AGENT_ISSUER` and `aud` = `SOLVAPAY_PROVIDER_REF`. The clone serves the agent as its pairwise principal (`ppl_…`), so the Opper project is `sp-ppl_…`, and tags each call with `agent_id`. A rejected token gets a 401 in Opper's shape.

```bash
pnpm agent:connect login you@example.com          # emails a sign-in code
pnpm agent:connect verify you@example.com 123456  # creates an agent, saves data/agent-credential
scripts/api-key-helper.sh                         # prints a fresh 15-minute agent token
```

Run Claude Code as that agent with `scripts/claude-as-agent.sh` (arguments pass through to `claude`). It removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, which outrank `apiKeyHelper`, leaves user settings out (a settings `env` can put `ANTHROPIC_API_KEY` back), and sets the helper and base URL through `--settings`. Run it from a normal terminal: Claude Code started from inside the Claude desktop app inherits the app's own auth.

## Card and first lot (S3)

`pnpm agent:connect` also stands in for the SolvaPay console until it exists. `verify` saves the account session to `data/account-session` (12 hours) and keeps the saved agent if its credential still works for that account. `card` then:

1. asks SolvaPay to link the account to a customer at this merchant and start a SetupIntent on the merchant's connected account;
2. serves a Stripe.js page on `http://127.0.0.1:3041/` (`CARD_PAGE_PORT`) and opens it; save the card there, with the 3DS test card 4000 0025 0000 3155;
3. waits for Stripe's `setup_intent.succeeded` webhook to reach the local stack, then charges the first lot off-session and prints the lot and the balance.

```bash
pnpm agent:connect login you@example.com
pnpm agent:connect verify you@example.com 123456
pnpm agent:connect card          # 2.50 USD lot; pass an amount in cents to change it
pnpm agent:connect merchant      # customer, card and balance at this merchant
```

The lot is a direct charge on the merchant's account, with `lot_id`, `agent_id` and `policy_id` in the PaymentIntent's metadata. `policy_id` is the agent's active spend policy, or `none` (the S3 lots say `mandate_id: none`, from before the rename).

## Debit by cost (S4)

An agent's `POST /v3/compat/v1/messages` goes through `@solvapay/server`'s `payable.gate()` in cost mode:

1. The clone finds the customer by the agent's principal (`externalRef`); it never creates one. No customer gives a 402 `customer_not_linked`.
2. The call is allowed while the balance covers the call's estimate (see below), else a 402 `topup_required`. Neither 402 reaches Opper.
3. When the stream ends, the clone settles at `usage.cost` from the final `message_delta`, exact to 1e-8 USD, so a call below one credit is still debited exactly.

A stream cut after the cost arrived is settled at that cost. A call Opper answered without a cost is settled once at the estimate, marked `provisional`. A call Opper refused (4xx or 5xx) is not settled. `call.completed` logs the debit and the balance after it.

## Spend policy (S5)

Before the balance gate, SolvaPay decides each agent call against the agent's spend policy (`POST /v1/sdk/agent/decide`). The order on `POST /v3/compat/v1/messages`:

1. The body is read once. Not JSON, or no `model`: an Anthropic 400, and neither SolvaPay nor Opper is called.
2. The estimate (`src/agent-layer/pricing.ts`): input tokens ≈ body bytes ÷ 4, output = min(`max_tokens`, 2,000), at Anthropic's list price for the model. The tier is the model family: Haiku S, Sonnet M, Opus L, anything else XL.
3. The customer, by the agent's principal; none gives a 402.
4. Decide: an allow reserves the estimate on the spend policy. Ask is an Anthropic 402 and deny an Anthropic 422, both with SolvaPay's reason text. Neither reaches Opper.
5. The balance gate at the same estimate. Refused: the reservation is released at once and the caller gets a 402 `topup_required`.
6. After the stream, the policy settle first (`POST /v1/sdk/agent/settle`), then the credit debit, whose usage row carries `decision_ref`. Settle rules are S4's: an Opper error releases the reservation.

The spend policy is set from the command line until the console has a page for it:

```bash
pnpm agent:connect policy create 5                  # 5 USD a month; ceiling, caps and top-up compiled from it
pnpm agent:connect policy create 5 --tiers S,M --per-call 0.50
pnpm agent:connect policy update tiers=S            # limits make a new version; spend carries over
pnpm agent:connect policy update status=paused      # or active, revoked
pnpm agent:connect policy show
```

`update` takes `budget`, `ceiling`, `per-call`, `daily`, `max-topup`, `tiers`, `rate`, `timezone` and `status`.

Every refusal on this route is Anthropic-shaped: `{"type":"error","error":{"type":"invalid_request_error","message":…},"request_id":…}`. The 401s stay in Opper's shape. `X-Opper-Tags` gains `decision_id`, and `call.completed` and `call.refused` log the decision, the policy and its counters.

## Top-ups (S6)

When an agent's call leaves its balance at this merchant below the spend policy's low-water mark, SolvaPay tops it up with no click. The clone does nothing for it: billing publishes each cost debit, and SolvaPay's agent-service decides a top-up against the policy and opens one lot off-session on the merchant's account, with `lot_id`, `agent_id`, `policy_id` and `decision_id` in the PaymentIntent's metadata. A top-up is allowed while the month's spend, the balance and the new lot fit the budget; past it, an ask is recorded and nothing is charged. The calls go on until the balance falls below one call's estimate, then get the 402 `topup_required`.

```bash
pnpm agent:connect policy update max-topup=0.50 low-water=2.74   # lot size, and the balance below which one is decided
pnpm agent:connect policy show                                   # the mark, a top-up being charged, the last refusal
scripts/run-turns.sh 15                                          # 15 one-sentence turns through claude-as-agent.sh
```

`run-turns.sh` stops at the first turn that fails. From the desktop app's terminal panel, wrap it in `env -i` as `claude-as-agent.sh` needs.

## Layout

| Path | What it does |
|---|---|
| `src/agent-layer/` | SolvaPay's part: agent token verification, metering, spend policy, pricing and error bodies; top-ups later |
| `src/routes/compat.ts` | `ALL /v3/compat/*`; `POST /v3/compat/v1/messages` is the paid route |
| `src/upstream/opper.ts` | Forwards with the user's key and `X-Opper-Tags`, streams the body, reads the cost when the stream ends |
| `src/merchant/merchant-keys.ts` | The clone's toy version of Opper's own API keys |
| `src/merchant/opper-accounts.ts` | One Opper project and key per user (ported from `solvapay/opper-mcp`) |
| `scripts/connect-agent.ts`, `scripts/card-page*` | Console stand-in: sign-in, agent, card and first lot |
| `data/` | Local state, git-ignored |

## Behaviour to know

- A call with no key is forwarded to Opper without credentials, so Opper gives its own 401 (or 404 for an unknown path). An unknown key gets a 401 in Opper's shape from the clone. See `FIDELITY.md`.
- Cost comes from `X-Opper-Cost` on a plain call and from the final `message_delta` event on a streamed call; Opper sends no cost header on streams.
