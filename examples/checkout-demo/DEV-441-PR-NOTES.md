# DEV-441 — PR notes (copy into PR description)

## Summary

- Deploy **checkout-demo** to Cloudflare Workers at **https://web-app-demo.solvapay.app** (OpenNext + Wrangler).
- Mirrors **chat-checkout-demo** deploy ergonomics (`scripts/deploy.mjs`, gitignored `.env.prod`, one-time secrets).

## Differences from chat-checkout-demo

| Topic | chat-checkout-demo | checkout-demo |
| --- | --- | --- |
| Runtime | Vite + `worker.ts` + `handlers.ts` | Next.js 16 + `@opennextjs/cloudflare` |
| Assets | Workers Assets `dist/` | OpenNext `.open-next/` bundle |
| Auth | Anonymous `x-customer-ref` | Supabase JWT + `middleware.ts` (Edge) |
| Secrets | `SOLVAPAY_SECRET_KEY`, `GEMINI_API_KEY` | `SOLVAPAY_SECRET_KEY`, `SUPABASE_JWT_SECRET` |
| Build-time env | `VITE_*` | `NEXT_PUBLIC_*` (via `.env.prod` + `build:opennext:prod`) |
| Prod domain | `chat-demo.solvapay.app` | `web-app-demo.solvapay.app` |
| pnpm scripts | `pnpm run deploy` / `deploy:prod` (if not conflicting) | `pnpm run deploy:cf` / `deploy:cf:prod` |

## Test plan

- [ ] `pnpm -w build:packages && cd examples/checkout-demo && pnpm build:opennext`
- [ ] `pnpm run deploy:cf` → `*.workers.dev` URL loads `/` (200)
- [ ] `pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY` + `SUPABASE_JWT_SECRET` on target Worker
- [ ] With valid `NEXT_PUBLIC_PRODUCT_REF` in `.env.prod`: `GET /api/list-plans?productRef=…` returns plans
- [ ] After SolvaPay CF account access: `pnpm run deploy:cf:prod` → **https://web-app-demo.solvapay.app**
- [ ] Supabase **ganvogeprtezdpakybib**: redirect URL `https://web-app-demo.solvapay.app/auth/callback`
- [ ] Sign-in + checkout with `4242 4242 4242 4242`

## Post-merge ops (assignee)

1. `wrangler login` with access to account `98aefe33182e11a1b0e5d7fa89a12a6d`.
2. Prod secrets: `wrangler secret put … --env production` (both keys).
3. `pnpm run deploy:cf:prod` from `examples/checkout-demo`.
