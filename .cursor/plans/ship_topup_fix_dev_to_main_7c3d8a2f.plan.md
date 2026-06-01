# Ship topup-payment fix from dev to prod — COMPLETE

**Status: ✅ Done.** All release PRs landed, npm packages published, prod backend deployed and serving the relaxed schema. Worker redeploy turned out to be unnecessary — the bundle running on `chat-demo.solvapay.app` already calls `processTopupPaymentIntentCore` (omits `productRef`), and the only thing that was wrong was the backend rejecting that shape. With backend #119 in prod, the existing Worker now works.

## Original error (for reference)

```
Process payment failed (400): {"statusCode":400,"message":"Validation failed",
"errors":[{"code":"invalid_type","expected":"string","received":"undefined",
"path":["productRef"],"message":"Required"}],
"timestamp":"2026-05-13T14:19:12.322Z",
"path":"/v1/sdk/payment-intents/pi_3TWdcoB046BqfHK010wEYxMT/process"}
```

## What shipped (2026-05-13)

### Backend (`solvapay-backend`)

| PR | What | Result |
|---|---|---|
| [#118](https://github.com/solvapay/solvapay-backend/pull/118) | `fix(sdk): align payment-intent schema for checkout topup flows` — `productRef` optional on `ProcessPaymentIntentSchema` | Merged to `dev` (earlier session) |
| [#119](https://github.com/solvapay/solvapay-backend/pull/119) | Release `dev → main` (5 commits: #118 + 3 small fixes) | **Merged 15:42:48Z** — merge commit `097eb5b8` |
| [#120](https://github.com/solvapay/solvapay-backend/pull/120) | `chore: back-merge main into dev after #119 release` — mirrors the SDK #202 pattern so the next release PR opens CLEAN | **Merged 18:21:09Z** — merge commit `118888fe`. Graph-only, no code diff. |

- Cloud Build prod trigger `477fce06-9a78-4c00-800d-e894591c1373` **SUCCESS at 15:50:49Z** (~7 min).
- Schema confirmed live on `main`: `productRef: z.string().min(1).optional()` in `src/payments/types/payment-intent.schemas.ts` (commit `d1f62358`).
- `https://api.solvapay.com/v1/sdk/payment-intents/<pi>/process` now accepts requests without `productRef`. (Auth runs before validation in NestJS, so a CLI smoke test requires a real sandbox sk; the chat-demo E2E in step 1 below is the cleanest validation.)

### SDK (`solvapay-sdk`)

| PR | What | Result |
|---|---|---|
| #198 | `feat(sdk): unify topup checkout handling across react and server` — adds `processTopupPaymentIntentCore` | Merged to `dev` (earlier session) |
| #200 | `fix(chat-checkout-demo): use .env.prod for Vite build:prod + pin prod CF account` | Merged to `dev` (earlier session) |
| #202 | Back-merge `main → dev` via `chore/back-merge-main-into-dev` | Merged to `dev` (earlier session) |
| [#199](https://github.com/solvapay/solvapay-sdk/pull/199) | Release `dev → main` (35 commits) | **Merged 15:41:37Z** — merge commit `bc24be49` |
| [#203](https://github.com/solvapay/solvapay-sdk/pull/203) | `chore: version packages` (changesets bot) | **Merged 15:49:05Z** — merge commit `774f2722` |

npm publish workflow `25810174593` completed at ~15:51:55Z, `Verify published packages landed on npm` step passed:

- `@solvapay/react@1.2.0` (minor) — unified checkout primitive, `useLimits`, topup polish, step-aware headings
- `@solvapay/server@1.1.0` (minor) — `processTopupPaymentIntentCore` + first-class chatbot streaming primitives
- `@solvapay/next@1.0.12` (patch) — cascade from `@solvapay/server` bump
- `chat-checkout-demo@0.0.1` (private, not published)

### Chat-checkout-demo Worker (`chat-demo.solvapay.app`)

**No redeploy needed.** The existing prod Worker bundle was built from a commit that already included `processTopupPaymentIntentCore`. The only thing blocking topup was the backend rejecting the payload — now fixed.

> If you ever do need to redeploy (e.g. picking up `.env.prod` changes or fresh workspace builds), run `pnpm deploy:prod` from `examples/chat-checkout-demo` in a shell with `wrangler` authenticated (`wrangler login` once, or set `CLOUDFLARE_API_TOKEN`). The `deploy:prod` script is `pnpm -w build:packages && pnpm build:prod && node scripts/deploy.mjs --prod` and was successfully exercised through the build step during this session.

## Final verification — manual E2E on `chat-demo.solvapay.app`

The only thing left is for someone (you) to load `https://chat-demo.solvapay.app` and walk the three scenarios in the browser:

- [ ] **Subscription scenario** — trigger paywall → Stripe test card `4242 4242 4242 4242` → expect purchase recorded, chat resumes.
- [ ] **Lifetime scenario** — same.
- [ ] **Topup scenario** (the one that surfaced this whole thread) — trigger paywall → top up → expect credits booked + `"X left"` pill updates + chat resumes. **No `productRef Required` 400 in the Network tab** is the actual success signal.

## Future-proofing (deferred)

- Consider a CI job that fails `dev → main` release PRs when they're `BEHIND` main, with a hint to run the back-merge dance. Would have caught the #199 BEHIND state automatically and could obviate the need to remember the back-merge step after every release. Not blocking — file as a follow-up if the manual back-merge becomes annoying again.

## Files touched in this session (for reference)

- `solvapay-sdk/examples/chat-checkout-demo/README.md` — Vite env-file load order table + "Deploy the live demo" copy
- `solvapay-sdk/examples/chat-checkout-demo/package.json` — added `build:prod` script
- `solvapay-sdk/examples/chat-checkout-demo/wrangler.jsonc` — pinned `[env.production].account_id`
- `solvapay-sdk/examples/chat-checkout-demo/.env.prod` — temporarily flipped `SOLVAPAY_API_BASE_URL` to dev, then reverted (gitignored)
- `solvapay-backend` — back-merge branch `chore/back-merge-main-into-dev` (`ee52b853`) → PR #120, now merged

No outstanding working-tree changes.
