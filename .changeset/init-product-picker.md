---
'solvapay': minor
---

Interactive product picker and product-ref validation in `solvapay init`.

`npx solvapay init` now configures `SOLVAPAY_PRODUCT_REF` end-to-end. After the secret key is verified:

- If `.env` already has a real product ref, the picker verifies it against `GET /v1/sdk/products/<ref>` and asks whether to keep it.
- Otherwise it lists products on the account (newest first, up to 10) and prompts the user to pick one. A single product confirms with `[Y/n]`; multiple products show a numbered list with default `1`.
- `--yes` (or non-interactive stdin) auto-picks the newest product.
- Zero products warns and points to SolvaPay Console → Products; init still completes.

Scaffold placeholders (`__SOLVAPAY_PRODUCT_REF__`) and missing values both trigger the picker automatically, so wrong / fake refs fail fast at init time instead of surfacing as cryptic OAuth or upstream errors later. New `product-picker.ts` + `products.ts` modules under `packages/cli/src/lib/` with full unit-test coverage.
