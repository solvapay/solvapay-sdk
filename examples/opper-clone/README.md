# Opper clone

A stand-in for Opper's Anthropic-compatible API (`/v3/compat`), run by SolvaPay for the agent payments proof of concept. It forwards each call to the real Opper API with a key minted for that user in SolvaPay's Opper organisation, and streams the answer back unchanged. Claude Code cannot tell it from Opper.

This is slice S1 of the build plan: pass-through only, no SolvaPay calls yet. The SolvaPay agent layer (agent token, `decide()`, cost reporting, agent-safe 402 and 422) arrives in later slices.

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

The lot is a direct charge on the merchant's account, with `lot_id`, `agent_id` and `mandate_id` in the PaymentIntent's metadata. The clone itself reads no balance yet.

## Layout

| Path | What it does |
|---|---|
| `src/agent-layer/` | SolvaPay's part: agent token verification now; policy, top-ups and metering later |
| `src/routes/compat.ts` | `ALL /v3/compat/*`; `POST /v3/compat/v1/messages` is the paid route |
| `src/upstream/opper.ts` | Forwards with the user's key and `X-Opper-Tags`, streams the body, reads the cost when the stream ends |
| `src/merchant/merchant-keys.ts` | The clone's toy version of Opper's own API keys |
| `src/merchant/opper-accounts.ts` | One Opper project and key per user (ported from `solvapay/opper-mcp`) |
| `scripts/connect-agent.ts`, `scripts/card-page*` | Console stand-in: sign-in, agent, card and first lot |
| `data/` | Local state, git-ignored |

## Behaviour to know

- A call with no key is forwarded to Opper without credentials, so Opper gives its own 401 (or 404 for an unknown path). An unknown key gets a 401 in Opper's shape from the clone. See `FIDELITY.md`.
- Cost comes from `X-Opper-Cost` on a plain call and from the final `message_delta` event on a streamed call; Opper sends no cost header on streams.
