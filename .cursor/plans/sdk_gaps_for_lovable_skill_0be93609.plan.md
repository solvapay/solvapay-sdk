---
name: sdk gaps for lovable skill
overview: 'SDK work required before the `lovable-checkout` skill can ship without workarounds: Tailwind v3 + v4 setup docs in a single README section, a dedicated non-Next `examples/spa-checkout` reference (Vite + React Router + TW v3 + shadcn + Supabase) mirroring the Lovable stack, preview version hygiene to retire the orphaned `1.0.9-preview.1`, verification that the `@preview` dist-tag resolves cleanly through `npm:` specifiers in Supabase Edge runtime, a CSS-loading-order callout, and wiring the new example into the non-Next bundle smoke CI in PR 8.'
todos:
  - id: gap1-tw-docs
    content: Tailwind v3 + v4 setup section in packages/react/README.md. Single section, two subsections (v4 recommended + v3 for Lovable/older projects). Covers config-less `@import "tailwindcss"` (v4) and `tailwind.config.ts` + `@tailwind base/components/utilities` (v3). Notes that styles.css is plain CSS and works with both. Includes CSS-loading-order callout (see gap6a). No content[] additions needed — primitives don't ship utility classes.
    status: pending
  - id: gap2-spa-scaffold
    content: "examples/spa-checkout/: scaffold Vite 5 + React 18 + SWC + TypeScript + Tailwind v3.4.17 + shadcn/ui + React Router v6 + @solvapay/react + @solvapay/react-supabase + @supabase/supabase-js. Routes: /, /login, /checkout, /dashboard. `<CheckoutLayout>` on /checkout with navigate('/dashboard') onResult. workspace:* deps for local dev, documented `@preview` overrides for paste-into-Lovable use."
    status: pending
  - id: gap2-spa-wire-backend
    content: Wire examples/spa-checkout to examples/supabase-edge backend. VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY env vars. SolvaPayProvider config.api.* pointed at `${VITE_SUPABASE_URL}/functions/v1/<fn>`. README documents both `supabase start` local flow and deployed flow. No backend code duplication.
    status: pending
  - id: gap3-deprecate-109
    content: Run ./scripts/deprecate-version.sh 1.0.9-preview.1 "orphaned preview - install with @preview tag for the current build" across the 7 affected packages (@solvapay/supabase was never on 1.0.9-preview.1 and is skipped automatically). Verify `npm view @solvapay/react@1.0.9-preview.1 deprecated` returns the message.
    status: pending
  - id: gap4-deno-preview
    content: 'Verify Supabase Edge (Deno 2.x) resolves `npm:<pkg>@preview`. If yes: update examples/supabase-edge/supabase/functions/deno.json to use `@preview` suffixes and deploy + invoke list-plans end-to-end. If no: do NOT pivot to semver-republish — flag to the Lovable skill plan that the skill must defer until stable cut. Add a CI job to examples/supabase-edge that deploys with `@preview` import map and smoke-tests list-plans.'
    status: pending
  - id: gap5-edge-readme
    content: "examples/supabase-edge/README.md: one-line note under '### 2. Import map' pointing Lovable-style integrators at `npm:@solvapay/supabase@preview` during the preview window. Stays compatible with stable path (drop `@preview` once 1.0.8 promotes to latest)."
    status: pending
  - id: gap6a-css-order-callout
    content: "CSS loading order callout in packages/react/README.md 'Tailwind setup' section: `import '@solvapay/react/styles.css'` AFTER your Tailwind entry so SolvaPay overrides resolve correctly. examples/spa-checkout/src/main.tsx demonstrates the ordering. Cheap; ships with gap1."
    status: pending
  - id: gap6b-layer-spike
    content: DEFERRED spike — wrap packages/react/src/styles.css rules in `@layer solvapay {}`. Requires test pass against TW v3 + v4 preflight AND verification that consumer one-off utility classes still beat SolvaPay defaults (layered rules lose to unlayered declarations — non-trivial specificity flip). Not blocking Lovable skill; revisit after visual regression baselines (PR 9).
    status: pending
  - id: gap7-pr8-smoke-ci
    content: "Add examples/spa-checkout to PR 8's non-Next bundle smoke CI matrix (alongside the Vite + Remix minimal builds already planned). Asserts: `npm run build` succeeds AND no `next/*` import appears in dist. Prevents future Next-only leakage into @solvapay/react from breaking Lovable silently."
    status: pending
isProject: false
---

# SDK gaps for the Lovable skill

## Context

The [mcp-app-checkout preview skill PR #5](https://github.com/solvapay/skills/pull/5) shipped without SDK changes because the MCP App flow can work around preview-only gaps in the skill doc. The forthcoming `lovable-checkout` skill cannot — it's pasted into Lovable's chat to produce working code on the first turn. Any gap in the SDK becomes a gap in what Lovable generates.

Confirmed from [`packages/react/package.json`](/Users/tommy/projects/solvapay/solvapay-sdk/packages/react/package.json) and [`packages/react/src/styles.css`](/Users/tommy/projects/solvapay/solvapay-sdk/packages/react/src/styles.css):

- React peer dep already `^18.2.0 || ^19.0.0` — no change needed.
- `styles.css` is plain CSS (no `@layer` / `@tailwind` / `@import`) — should coexist with Tailwind v3 and v4 preflight; needs a loading-order callout (gap6a) and an optional `@layer` wrap (gap6b, deferred).

## Naming and scope decisions

- **Example is `examples/spa-checkout`**, not `examples/vite-checkout`. Vite alone isn't the axis — the architectural axis is SPA vs SSR. `spa-checkout` pairs naturally with the existing Next.js `checkout-demo` / `tailwind-checkout` / `shadcn-checkout` and absorbs future agentic scaffolders (v0, Bolt) that ship Vite SPA setups without a rename.
- **Skill split is per target, not per Tailwind version.** `lovable-checkout` targets Lovable's current stack (TW v3 today). If Lovable moves to v4, bump the skill. A future `v0-checkout` or `bolt-checkout` picks up whatever its target ships. TW version falls out of target selection.
- **Docs cover both TW versions in one section.** `packages/react/README.md` gains a "Tailwind setup" section with v4 + v3 subsections. The example picks one (v3) because it has to compile; the docs cover both because readers come from both.

## Out of scope (handled elsewhere)

- Visual regression baselines — PR 9, post-Lovable sign-off.
- Hosted shadcn registry — cross-repo follow-up.
- `@layer solvapay {}` wrap of `styles.css` — deferred spike, gap6b.

---

## Gap 1 — Tailwind v3 + v4 setup section in README

Current state: [`examples/tailwind-checkout`](/Users/tommy/projects/solvapay/solvapay-sdk/examples/tailwind-checkout) and [`examples/shadcn-checkout`](/Users/tommy/projects/solvapay/solvapay-sdk/examples/shadcn-checkout) both use Tailwind v4's config-less `@import "tailwindcss"` syntax. Lovable's stack is Tailwind v3.4.17 with classic `tailwind.config.ts`. Pasting the current README into Lovable would produce v4 syntax that breaks.

### Work

Add a **"Tailwind setup"** section to [`packages/react/README.md`](/Users/tommy/projects/solvapay/solvapay-sdk/packages/react/README.md). Insert before the "Golden path" section, after "Peer Dependencies".

Structure:

````markdown
## Tailwind setup

SolvaPay primitives ship plain CSS. They work with Tailwind v3 and v4
identically. Import `@solvapay/react/styles.css` **after** your Tailwind
entry so SolvaPay rules resolve above preflight.

### Tailwind v4 (recommended for new projects)

`src/index.css`:
​`css
@import "tailwindcss";
@import "@solvapay/react/styles.css";
​`

No `tailwind.config.ts` needed. Theme via `@theme` block if desired.

### Tailwind v3 (Lovable, older projects)

`tailwind.config.ts`:
​`ts
import type { Config } from 'tailwindcss'
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
​`

`src/index.css`:
​`css
@tailwind base;
@tailwind components;
@tailwind utilities;
@import "@solvapay/react/styles.css";
​`

No `content[]` entry for `@solvapay/react` — primitives don't ship utility
classes. `data-[state=*]:` variants work natively in v3.3+.

### CSS loading order

Always import `@solvapay/react/styles.css` **after** `@tailwind utilities`
(v3) or `@import "tailwindcss"` (v4). SolvaPay rules are unlayered; they
beat Tailwind's preflight when loaded last.
````

### Acceptance

- [ ] README section renders correctly on npm (`npm view @solvapay/react readme`)
- [ ] Both config blocks are copy-paste runnable; verified by scaffolding a throwaway v3 project and a v4 project with each block verbatim
- [ ] No `content[]` entry for `@solvapay/react` in v3 config (confirm primitives render without it)

---

## Gap 2 — `examples/spa-checkout` (Vite + React Router SPA, TW v3 + shadcn + Supabase)

Current state: all three checkout examples are Next.js. Lovable's stack is Vite + React Router v6 SPA. The SDK works in a SPA but there's no reference project to copy from, and docs implicitly assume App Router redirects (`redirect('/dashboard')` after payment).

This example is the **primary** reference for the `lovable-checkout` skill — the minimum diff from what Lovable's default scaffolder produces.

### Stack (mirrors Lovable exactly)

- Vite 5 + React 18 + `@vitejs/plugin-react-swc`
- TypeScript 5
- Tailwind v3.4.17 + `autoprefixer` + `postcss`
- shadcn/ui components (copy-generated, not a package)
- `react-router-dom@^6`
- `@supabase/supabase-js@^2`
- `@solvapay/react` + `@solvapay/react-supabase` (workspace:\* locally; `@preview` tag when pasted into Lovable)
- Backend: reuse [`examples/supabase-edge`](/Users/tommy/projects/solvapay/solvapay-sdk/examples/supabase-edge). No duplication.

### File tree

```
examples/spa-checkout/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tailwind.config.ts
├── postcss.config.js
├── components.json                  # shadcn
├── index.html
├── .env.example                     # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── README.md
└── src/
    ├── main.tsx                     # imports tailwind + solvapay styles in correct order
    ├── index.css                    # @tailwind directives + @import solvapay/styles
    ├── App.tsx                      # <BrowserRouter> + routes
    ├── lib/
    │   ├── supabase.ts              # createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
    │   ├── solvapay-config.ts       # SolvaPayProvider config factory
    │   └── utils.ts                 # shadcn `cn`
    ├── providers.tsx                # <SolvaPayProvider> + <AuthProvider>
    ├── routes/
    │   ├── Home.tsx                 # /
    │   ├── Login.tsx                # /login (Supabase email auth)
    │   ├── Checkout.tsx             # /checkout — <CheckoutLayout>
    │   └── Dashboard.tsx            # /dashboard — post-payment landing
    └── components/ui/               # shadcn primitives (button, card, input)
```

### Port

- `dev`: `5173` (Vite default) — keeps away from the 30xx Next.js range used by sibling examples.

### Key file contents

**`src/main.tsx`** — critical: CSS import order demonstrates Gap 6a.

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css' // tailwind + solvapay/styles.css (in that order inside the file)
import { App } from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

**`src/index.css`**:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
@import '@solvapay/react/styles.css';
```

**`src/App.tsx`**:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Providers } from './providers'
import { Home } from './routes/Home'
import { Login } from './routes/Login'
import { Checkout } from './routes/Checkout'
import { Dashboard } from './routes/Dashboard'

export function App() {
  return (
    <BrowserRouter>
      <Providers>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </Providers>
    </BrowserRouter>
  )
}
```

**`src/routes/Checkout.tsx`** — the post-payment redirect pattern, the one thing most different from the App Router examples:

```tsx
import { CheckoutLayout } from '@solvapay/react'
import { useNavigate } from 'react-router-dom'

export function Checkout() {
  const navigate = useNavigate()
  return (
    <CheckoutLayout
      onResult={r => {
        if (r.kind === 'paid' || r.kind === 'activated') navigate('/dashboard')
      }}
    />
  )
}
```

**`src/lib/solvapay-config.ts`**:

```ts
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { supabase } from './supabase'

const EDGE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export function createSolvaPayConfig() {
  return {
    auth: { adapter: createSupabaseAuthAdapter(supabase) },
    api: {
      checkPurchase: `${EDGE}/check-purchase`,
      createPayment: `${EDGE}/create-payment-intent`,
      processPayment: `${EDGE}/process-payment`,
      createTopupPayment: `${EDGE}/create-topup-payment-intent`,
      customerBalance: `${EDGE}/customer-balance`,
      cancelRenewal: `${EDGE}/cancel-renewal`,
      reactivateRenewal: `${EDGE}/reactivate-renewal`,
      activatePlan: `${EDGE}/activate-plan`,
      listPlans: `${EDGE}/list-plans`,
      getMerchant: `${EDGE}/get-merchant`,
      getProduct: `${EDGE}/get-product`,
    },
  }
}
```

**`.env.example`**:

```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<from `supabase status`>
```

### `package.json` shape

```json
{
  "name": "spa-checkout",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "pnpm exec eslint . --ignore-pattern dist"
  },
  "dependencies": {
    "@solvapay/react": "workspace:*",
    "@solvapay/react-supabase": "workspace:*",
    "@supabase/supabase-js": "^2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react-swc": "^3.7.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.41",
    "tailwindcss": "3.4.17",
    "typescript": "^5.5.3",
    "vite": "^5.4.0"
  }
}
```

> `workspace:*` for local dev; the README + Lovable skill document the `@preview` tag swap for paste-into-Lovable use.

### README outline

1. **What this is** — SPA reference for SolvaPay; mirrors Lovable's default stack. One paragraph.
2. **Stack** — bulleted list.
3. **Prereqs** — supabase CLI, node 18+, `examples/supabase-edge` deployed or running locally.
4. **Local setup** —
   ```bash
   cd examples/supabase-edge && supabase start && supabase functions serve
   cd ../spa-checkout && cp .env.example .env && pnpm install && pnpm dev
   ```
5. **Paste-into-Lovable swap** — single code block showing `workspace:*` → `@preview` in `package.json` and env-var setup.
6. **Vite env-var rule** — one paragraph: use `VITE_*` prefix; `import.meta.env.VITE_*`; never `process.env`.
7. **Routing** — show the `onResult` → `navigate` pattern explicitly.

### Acceptance

- [ ] `pnpm --filter spa-checkout dev` starts Vite on 5173
- [ ] `pnpm --filter spa-checkout build` succeeds
- [ ] Grep `dist/` for `next/` — zero matches
- [ ] Visual parity with `examples/tailwind-checkout` for the CheckoutLayout render (same shadcn primitives → similar look)
- [ ] End-to-end: login → /checkout → pay → redirected to /dashboard

---

## Gap 3 — Preview version hygiene

Current state per [`sdk_headless_v2_sdk-only_d067ca0f.plan.md`](/Users/tommy/projects/solvapay/solvapay-frontend/.cursor/plans/sdk_headless_v2_sdk-only_d067ca0f.plan.md): `1.0.9-preview.1` is the orphaned preview published without primitives. `@preview` dist-tag points at `1.0.8-preview.4`+ (fresh track above `1.0.7` stable).

Problem for Lovable: Lovable's starter template pins `@solvapay/react@1.0.9-preview.1` exactly. `npm install` gives them the broken build. `npm view @solvapay/react` shows `1.0.9-preview.1` as highest version, confusing humans and agents.

### Work

```bash
./scripts/deprecate-version.sh \
  1.0.9-preview.1 \
  "orphaned preview - install with @preview tag for the current build"
```

Deprecates across 7 packages that got `1.0.9-preview.1`. `@solvapay/supabase` never had that version → skipped automatically.

### Acceptance

- [ ] `npm view @solvapay/react@1.0.9-preview.1 deprecated` returns the configured message
- [ ] Same check on `@solvapay/core`, `@solvapay/auth`, `@solvapay/next`, `@solvapay/react-supabase`, `@solvapay/server`, `solvapay` (cli)
- [ ] `npm install @solvapay/react@preview` in a scratch repo installs `1.0.8-preview.4` or higher (current `@preview` head)

### Reversibility

`npm deprecate @solvapay/react@1.0.9-preview.1 ""` (empty string) un-deprecates. Option B (republish above with `1.0.10-preview.1`) is deferred to the stable-cut follow-up.

---

## Gap 4 — Supabase Edge + `npm:@preview` specifier resolution

Current state: [`examples/supabase-edge/supabase/functions/deno.json`](/Users/tommy/projects/solvapay/solvapay-sdk/examples/supabase-edge/supabase/functions/deno.json) maps `"@solvapay/supabase": "npm:@solvapay/supabase"` — resolves to `@latest` (currently `1.0.1` for supabase pkg, pre-primitives). The Lovable skill needs `@preview` end-to-end.

### Work

1. **Spike**: in a scratch Supabase project, set `deno.json` to `"@solvapay/supabase": "npm:@solvapay/supabase@preview"` and invoke `list-plans`. Verify function cold-starts and responds.
2. **If it works**: update `examples/supabase-edge/supabase/functions/deno.json` to append `@preview` on all four imports. Commit.
3. **If it doesn't work**: do NOT pivot to Gap 3 Option B (semver-republish). Instead, flag to [`lovable-checkout_preview_skill_0936277f.plan.md`](/Users/tommy/projects/solvapay/solvapay-frontend/.cursor/plans/lovable-checkout_preview_skill_0936277f.plan.md) that the Lovable skill must defer until the stable cut and update the skill's blocker section.
4. **CI**: add a GitHub Actions job to the sdk repo that deploys `examples/supabase-edge` against a disposable Supabase project with `@preview` in the import map, invokes `list-plans`, and asserts HTTP 200 + a well-formed response. Runs on every `examples/supabase-edge/**` change.

### Acceptance

- [ ] `deno.json` uses `@preview` on all four `@solvapay/*` imports
- [ ] `supabase functions deploy list-plans` succeeds locally
- [ ] `curl $EDGE/list-plans` returns 200
- [ ] CI job passes on a clean branch

---

## Gap 5 — Supabase Edge example uses the preview tag

Current state: [`examples/supabase-edge/README.md`](/Users/tommy/projects/solvapay/solvapay-sdk/examples/supabase-edge/README.md) documents `npm:@solvapay/supabase` without a tag.

### Work

In the `### 2. Import map` subsection (around line 49), insert a callout directly after the JSON block:

```markdown
> **Preview builds**: during the primitives preview window, use
> `npm:@solvapay/supabase@preview` (and the same for the other three imports).
> Drop the `@preview` suffix once `1.0.8` promotes to `@latest`.
```

### Acceptance

- [ ] README note renders on GitHub
- [ ] Lovable skill's paste-in block references this README as the source of truth

---

## Gap 6a — CSS loading order callout (ships with Gap 1)

Current state: `styles.css` is plain CSS imported via `import '@solvapay/react/styles.css'`. Tailwind v3 preflight sets base styles on `button`, `input`, `a`. If `styles.css` imports **before** `@tailwind base`, preflight wins; **after**, SolvaPay's golden-path wins.

### Work

Documented as part of Gap 1's "CSS loading order" subsection. No separate work item beyond authoring that paragraph.

The `examples/spa-checkout/src/index.css` file is the canonical demonstration — `@tailwind` directives first, `@solvapay/react/styles.css` import last.

### Acceptance

- [ ] Section appears in README
- [ ] `examples/spa-checkout/src/index.css` matches the documented order

---

## Gap 6b — `@layer solvapay {}` wrap (DEFERRED spike)

Wrap `packages/react/src/styles.css` rules in `@layer solvapay {}` so Tailwind's `@layer base` preflight is trumped automatically.

### Why deferred

CSS cascade layers invert specificity: **layered rules lose to unlayered declarations**. If a consumer writes `<button className="bg-red-500">` (an unlayered Tailwind utility in most setups), it now wins over `@layer solvapay { button { background: #fff } }`. That's probably what we want — but it's also the _opposite_ of what we'd want if a consumer writes `<button style="...">` or any one-off rule outside Tailwind's layers. Needs real test cases.

### Prerequisites before picking this up

1. Inventory every rule in `styles.css` and classify: "should lose to consumer overrides" vs "must win always".
2. Test matrix: TW v3 project + TW v4 project + raw CSS consumer (no Tailwind). Each with `<CheckoutLayout>` rendered and an intentional override applied three ways (utility class, `style={}`, unlayered CSS rule).
3. Decide if we want `@layer solvapay { … }` OR `@layer base, solvapay` (named ordering) OR leave unlayered with the import-order rule.

### Not blocking

Gap 6a's import-order rule is sufficient for Lovable. Revisit this spike after the PR 9 visual regression baselines land.

---

## Gap 7 — PR 8 bundle smoke CI includes `spa-checkout`

Current state: [`sdk_headless_v2_sdk-only_d067ca0f.plan.md`](/Users/tommy/projects/solvapay/solvapay-frontend/.cursor/plans/sdk_headless_v2_sdk-only_d067ca0f.plan.md) PR 8 plans a "non-Next bundle smoke (Vite + Remix)". `examples/spa-checkout` is the realistic Vite target — richer than a toy importer.

### Work

In PR 8's CI matrix, replace (or augment) the toy Vite bundle smoke with:

```yaml
- name: Build examples/spa-checkout
  run: pnpm --filter spa-checkout build
- name: Assert no next/* leakage
  run: |
    if grep -rE "from ['\"]next/" examples/spa-checkout/dist; then
      echo "::error::next/* import leaked into SPA build"
      exit 1
    fi
```

Keeps the Remix smoke build as-is (different bundler behavior).

### Acceptance

- [ ] PR 8's CI workflow file references `examples/spa-checkout`
- [ ] A deliberately added `import 'next/navigation'` anywhere in `@solvapay/react` fails the CI job (red-test the guard)

---

## Assumed built for the skill

The `lovable-checkout` skill plan assumes this plan is done. Specifically:

- `@preview` dist-tag resolves to a working primitives build on every package the skill installs (`@solvapay/react`, `@solvapay/react-supabase`, `@solvapay/supabase`, `@solvapay/server`, `@solvapay/auth`, `@solvapay/core`).
- `1.0.9-preview.1` deprecation warning fires on `npm install`.
- `examples/spa-checkout/` exists and the skill can point at it.
- `examples/supabase-edge/supabase/functions/deno.json` uses `npm:@solvapay/supabase@preview` (pending Gap 4 spike result).
- Tailwind v3 + v4 + `styles.css` coexistence is documented in `packages/react/README.md` and verified visually.

## Out-of-plan follow-ups (not blocking)

- `SolvaPayConfig.api.baseUrl` shortcut (currently each endpoint is set individually in `config.api.*`). Would simplify the Lovable snippet but is an API expansion — take after stable cut.
- React Query coexistence note — `SolvaPayProvider` uses its own `useState` + custom refetch; no conflict with `@tanstack/react-query`. One sentence in README; no code change.

## Rough effort

| Gap                                                   | Effort                                             | Notes                                                      |
| ----------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| 1 — TW v3+v4 README section                           | ~45 min                                            | Straight authoring once gap2 files exist to point at       |
| 2 — `examples/spa-checkout` scaffold + backend wiring | ~1 day                                             | Biggest item; shadcn component generation is the long tail |
| 3 — deprecate 1.0.9-preview.1                         | ~15 min                                            | One shell script + spot-check                              |
| 4 — Deno `@preview` verify + CI                       | ~1 hour (happy path) / escalate if the spike fails | Happy path is the assumption                               |
| 5 — supabase-edge README note                         | ~5 min                                             |                                                            |
| 6a — CSS order callout                                | 0 (folded into gap1)                               |                                                            |
| 6b — `@layer` spike                                   | DEFERRED                                           | Not counted                                                |
| 7 — PR 8 CI wiring                                    | ~30 min                                            | Needs to land in the PR 8 branch, not this plan's PR       |

**Total for the Lovable skill unblock: ~1.5 dev days.**
