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

## Layout

| Path | What it does |
|---|---|
| `src/routes/compat.ts` | `ALL /v3/compat/*`; `POST /v3/compat/v1/messages` is the paid route |
| `src/upstream/opper.ts` | Forwards with the user's key and `X-Opper-Tags`, streams the body, reads the cost when the stream ends |
| `src/merchant/merchant-keys.ts` | The clone's toy version of Opper's own API keys |
| `src/merchant/opper-accounts.ts` | One Opper project and key per user (ported from `solvapay/opper-mcp`) |
| `data/` | Local state, git-ignored |

## Not yet

- Error bodies are Anthropic's shapes; checking them against Opper's is task 1.6.
- Where Opper reports the cost of a streamed call is task 1.5: the log line shows whether `X-Opper-Cost` arrives on a stream.
