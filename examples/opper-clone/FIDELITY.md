# Fidelity against Opper

Checked live on 8 Oct 2026 against `https://api.opper.ai/v3/compat`, with Claude Code 2.1.286.

## Responses

| Case | Opper | Clone | How |
|---|---|---|---|
| Plain call | 200, `X-Opper-Cost` header, `usage.cost` in the body | Same | Forwarded |
| Streamed call | 200 `text/event-stream`, **no cost header**; cost in the final `message_delta` event as `usage.cost` | Same | Forwarded; the clone reads the cost from that event |
| Unknown model | 404 `{"error":{"type":"not_found_error",...},"type":"error"}` | Same | Forwarded |
| Bad JSON | 400 `{"error":{"type":"invalid_request_error",...},"type":"error"}` | Same | Forwarded |
| No key | 401 `{"error":"No API key was sent. ...","docs_url":...}` | Same | Forwarded without credentials |
| Unknown path (Claude Code's `/api/hello` probe) | 404 `{"errors":[{"type":"HTTPException",...}]}` | Same | Forwarded without credentials |
| Unknown key | 401 `{"error":"invalid bearer token. ...","docs_url":...}` | 401 `{"error":"invalid bearer token. ..."}` | Answered by the clone, without Opper's sign-up links |

Opper's 401 bodies are not Anthropic-shaped; the other errors on this route are.

## Headers Opper returns

`x-opper-cost` (plain calls only), `x-opper-served-model`, `x-opper-served-provider`, `x-opper-served-service-tier`, `x-opper-trace-id`. The trace id is logged per call for reconciliation.

## Costs seen

| Call | Cost (USD) |
|---|---|
| Haiku, "say hi", 13 tokens in, 6 out | 0.000043 |
| Claude Code main turn (Sonnet, streamed) | 0.2956 |
| Claude Code side call (not streamed) | 0.0059 |

A short Haiku call costs less than one SolvaPay credit (0.0001 USD), so debiting by cost needs sub-credit precision (build plan §6 change 4).

## Not checked

- A project blocked by a budget rule or an exhausted organisation balance (Opper's 402).
- Opper's 5xx and 429 bodies.
