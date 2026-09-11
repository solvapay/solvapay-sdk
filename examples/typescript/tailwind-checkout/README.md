# Tailwind checkout example

Next.js App Router checkout built from `@solvapay/react/primitives` and styled with plain
Tailwind v4 utilities plus `data-[state=…]:` variants. No component library, and no
`@solvapay/react/styles.css` import — every pixel is styled in userspace.

Its sibling [`shadcn-checkout`](../shadcn-checkout) is the same app mapped onto
[shadcn/ui](https://ui.shadcn.com) components via `asChild`.

## Quick start

```bash
# from the repo root
pnpm install
pnpm build:packages

cd examples/typescript/tailwind-checkout
cp .env.example .env
pnpm dev   # http://localhost:3011
```

Runs keyless: `lib/solvapay.ts` falls back to `createStubSolvaPay()` from
`@solvapay/examples-shared/next-stub` unless `SOLVAPAY_SECRET_KEY` is set, so checkout
works end-to-end without a backend.

## Environment variables

| Variable                           | Required | Description                                                                         |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF` | Yes      | Product reference passed to `PlanSelector.Root`. `.env.example` ships a placeholder |
| `SOLVAPAY_SECRET_KEY`              | No       | Set it to swap the stub for the real SolvaPay backend                               |

## The four files to copy

| File                                      | Role                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `app/providers.tsx`                       | Mounts `<SolvaPayProvider>` with the auth adapter and API route map       |
| `lib/solvapay.ts`                         | Returns the process-wide `SolvaPay` instance                              |
| `app/api/solvapay/[...solvapay]/route.ts` | Catch-all dispatcher forwarding each route to its `@solvapay/next` helper |
| `app/checkout/page.tsx`                   | `PlanSelector` + `PaymentForm` styled with Tailwind utilities             |

`app/providers.tsx` ships a fixed stub auth adapter so the demo runs without an auth
provider. Swap it for your own — e.g. `SupabaseAuthAdapter` from `@solvapay/react-supabase`.

## Styling the primitives

Each primitive exposes its state as a `data-state` attribute, so a Tailwind variant is all
you need to react to it:

```tsx
<PlanSelector.Card
  className="
    data-[state=selected]:ring-2 data-[state=selected]:ring-slate-900
    data-[state=current]:border-emerald-600
    data-[state=disabled]:cursor-not-allowed data-[state=disabled]:opacity-60
  "
/>
```

## Routes

| Route       | Contents                                                            |
| ----------- | ------------------------------------------------------------------- |
| `/`         | Landing page linking to the two flows                               |
| `/checkout` | Plan picker, customer fields, inline Stripe Elements, terms consent |
| `/topup`    | `AmountPicker` + `TopupForm` for credit top-ups                     |

## Related documentation

- [React guide](../../../docs/guides/react.mdx) — hooks and components
- [Next.js guide](../../../docs/guides/nextjs.mdx) — route helpers
- [Examples overview](../../../docs/guides/examples.mdx)
