# shadcn checkout example

Next.js App Router checkout built from `@solvapay/react/primitives` and mapped onto
[shadcn/ui](https://ui.shadcn.com) components with `asChild`. The SolvaPay primitives own
the behaviour (state machine, accessibility, `data-state` attributes); the shadcn
components own every pixel.

Its sibling [`tailwind-checkout`](../tailwind-checkout) is the same app styled with plain
Tailwind utilities instead of a component library.

## Quick start

```bash
# from the repo root
pnpm install
pnpm build:packages

cd examples/typescript/shadcn-checkout
cp .env.example .env
pnpm dev   # http://localhost:3012
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

The example is deliberately shaped as a copy-paste registry — port these four into your
own project and you have a working checkout:

| File                                      | Role                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `app/providers.tsx`                       | Mounts `<SolvaPayProvider>` with the auth adapter and API route map       |
| `lib/solvapay.ts`                         | Returns the process-wide `SolvaPay` instance                              |
| `app/api/solvapay/[...solvapay]/route.ts` | Catch-all dispatcher forwarding each route to its `@solvapay/next` helper |
| `app/checkout/page.tsx`                   | `PlanSelector` + `PaymentForm` composed against shadcn primitives         |

`app/providers.tsx` ships a fixed stub auth adapter so the demo runs without an auth
provider. Swap it for your own — e.g. `SupabaseAuthAdapter` from `@solvapay/react-supabase`.

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
