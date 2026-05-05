---
name: rename day pass to lifetime
overview: Rename the "Day Pass" scenario in the SDK's chat-checkout-demo to "Lifetime Access" — UI strings, code identifiers, env var, and the form filename — and drop all "24h / 24 hours / pass duration" copy since lifetime access doesn't expire.
todos:
  - id: identifiers
    content: Rename ScenarioType.DAYPASS → LIFETIME, env.daypass → env.lifetime, hasDayPass → hasLifetimeAccess, isDayPassScenario → isLifetimeScenario across types.ts, env.ts, App.tsx, ChatWindow.tsx, Paywall.tsx
    status: pending
  - id: form-file
    content: Rename components/DayPassForm.tsx → components/LifetimeAccessForm.tsx and update component/interface/log-prefix names inside
    status: pending
  - id: ui-strings
    content: Update all user-facing strings (tab label, pill, tooltip, paywall heading/CTA/bullets, form heading/copy/notices) and drop all 24h / 24 hours / pass duration wording
    status: pending
  - id: drawer-comment
    content: Update DrawerHeader.tsx comment to mention lifetime access instead of day pass
    status: pending
  - id: env-files
    content: Rename VITE_DAYPASS_PRODUCT_REF → VITE_LIFETIME_PRODUCT_REF and update comments in env.example, .env, .env.prod
    status: pending
  - id: readme
    content: "Update README.md: scenario bullets, env-var table, plan-setup table, primitive map, usePurchase blurb, Vite-build-assets line, day-pass-expiry caveat"
    status: pending
  - id: verify
    content: Run typecheck and rg -i 'day.?pass|daypass' over examples/chat-checkout-demo to confirm zero stragglers
    status: pending
isProject: false
---


## Scope

Edits are confined to `solvapay-sdk/examples/chat-checkout-demo/`. The sibling `solvapay-chat-checkout-demo/` workspace also has day-pass references — leaving it untouched unless you ask otherwise.

## 1. Rename code identifiers

- [examples/chat-checkout-demo/types.ts](examples/chat-checkout-demo/types.ts): `DAYPASS = 'daypass'` → `LIFETIME = 'lifetime'`
- [examples/chat-checkout-demo/src/lib/env.ts](examples/chat-checkout-demo/src/lib/env.ts): `daypass: { productRef: readEnv('VITE_DAYPASS_PRODUCT_REF', false) }` → `lifetime: { productRef: readEnv('VITE_LIFETIME_PRODUCT_REF', false) }`
- [examples/chat-checkout-demo/App.tsx](examples/chat-checkout-demo/App.tsx):
  - `ScenarioType.DAYPASS` → `ScenarioType.LIFETIME`
  - `env.daypass.productRef` → `env.lifetime.productRef`
  - `hasDayPass` local + prop → `hasLifetimeAccess`
- [examples/chat-checkout-demo/components/ChatWindow.tsx](examples/chat-checkout-demo/components/ChatWindow.tsx):
  - `hasDayPass` prop → `hasLifetimeAccess`
  - Import `DayPassForm` → `LifetimeAccessForm` (new path)
  - All `ScenarioType.DAYPASS` → `ScenarioType.LIFETIME`
- [examples/chat-checkout-demo/components/Paywall.tsx](examples/chat-checkout-demo/components/Paywall.tsx): `isDayPassScenario` → `isLifetimeScenario`, `ScenarioType.DAYPASS` → `ScenarioType.LIFETIME`

## 2. Rename file + component

- Rename [examples/chat-checkout-demo/components/DayPassForm.tsx](examples/chat-checkout-demo/components/DayPassForm.tsx) → `components/LifetimeAccessForm.tsx`
- Inside: `DayPassForm` / `DayPassFormProps` → `LifetimeAccessForm` / `LifetimeAccessFormProps`, log prefix `[DayPassForm]` → `[LifetimeAccessForm]`, `env.daypass.productRef` → `env.lifetime.productRef`

## 3. Update user-facing strings (drop all duration copy)

- `App.tsx` scenario tab: `'Day Pass'` → `'Lifetime Access'`
- `ChatWindow.tsx` header pill: `'DAY PASS'` → `'LIFETIME'`
- `ChatWindow.tsx` pricing tooltip (lines ~350-360): replace `Day pass: {price} for 24h unlimited.` / `Day pass: unlimited.` with `Lifetime access: {price}.` / `Lifetime access: unlimited messages.`
- `Paywall.tsx`:
  - subhead `'Get a day pass to continue'` → `'Get lifetime access to continue'`
  - CTA `'Get Day Pass'` → `'Get Lifetime Access'`
  - bullets in `buildBullets` for the lifetime branch: drop the `for 24 hours` bullet entirely; keep only `${price}` (or `One-time payment` when no plan) and `Unlimited messages`
- `LifetimeAccessForm.tsx`:
  - success heading `'Day Pass activated'` → `'Lifetime access activated'`
  - success copy `'Unlimited messages for the pass duration.'` → `'Unlimited messages.'`
  - missing-env notice: `enable the day pass scenario` → `enable the lifetime access scenario`, `VITE_DAYPASS_PRODUCT_REF` → `VITE_LIFETIME_PRODUCT_REF`
  - product/plan fallbacks `'Day Pass'` → `'Lifetime Access'`
  - product description fallback `'Get unlimited messages with our day pass.'` → `'Get unlimited messages with lifetime access.'`
  - paid-plan-missing notice: `enable day pass checkout` → `enable lifetime access checkout`
- [examples/chat-checkout-demo/components/DrawerHeader.tsx](examples/chat-checkout-demo/components/DrawerHeader.tsx): comment `(subscription, day pass, top-up)` → `(subscription, lifetime access, top-up)`

## 4. Env files + docs

- [examples/chat-checkout-demo/env.example](examples/chat-checkout-demo/env.example): comment + `VITE_DAYPASS_PRODUCT_REF` → `VITE_LIFETIME_PRODUCT_REF`
- [examples/chat-checkout-demo/.env](examples/chat-checkout-demo/.env) and [examples/chat-checkout-demo/.env.prod](examples/chat-checkout-demo/.env.prod): same rename (gitignored, but the locally-set product ref must move to the new var name or the scenario goes blank)
- [examples/chat-checkout-demo/README.md](examples/chat-checkout-demo/README.md): update the bullet under scenarios, the `VITE_DAYPASS_PRODUCT_REF` row, the "Plan setup" table row, the scenario→primitive table row (`DayPassForm.tsx` → `LifetimeAccessForm.tsx`), the `usePurchase()` blurb (`hasDayPass` → `hasLifetimeAccess`), the "Vite build assets" line, and the "Day-pass expiry" caveat (replace with a one-line note that lifetime access never expires server-side, or remove it entirely)

## 5. Verify

Run from the demo dir: `pnpm typecheck` (or `tsc --noEmit` via the workspace) to make sure no straggling `DAYPASS` / `hasDayPass` / `env.daypass` references remain. Final `rg -i 'day.?pass|daypass'` over the demo folder should return zero matches.

## Out of scope

- The sibling `solvapay-chat-checkout-demo/` workspace (separate repo, also has Day Pass references including a `DayPassModal.tsx`). Tell me if you want the same rename applied there as a follow-up.
