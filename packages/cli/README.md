# solvapay

SolvaPay CLI.

## Usage

```bash
# Run the SolvaPay CLI init flow
npx solvapay init

# Skip browser confirmation prompt
npx solvapay init --yes

# Target the SolvaPay dev backend (api-dev.solvapay.com). Internal
# testing only — production keys are rejected by api-dev.
npx solvapay init --dev
```

## Flags

| Flag | Description |
| --- | --- |
| `-y`, `--yes` | Auto-create `package.json` and skip the browser confirmation prompt. |
| `--dev` | Target the SolvaPay dev backend (`https://api-dev.solvapay.com`) for browser-auth and all downstream `.env`-driven SDK calls. Persists `SOLVAPAY_API_BASE_URL` to `.env`. Internal testing only. |

## What `solvapay init` does

- Checks for `package.json` (and can create one if missing)
- Shows auth URL and asks you to press Enter before opening browser authentication
- Writes `SOLVAPAY_SECRET_KEY` to `.env` (with overwrite confirmation)
- Ensures `.env` is ignored in `.gitignore`
- Installs `@solvapay/server` and `@solvapay/core`
- Verifies the key and prints a setup summary

## Product configuration

After the secret key is verified, `solvapay init` configures `SOLVAPAY_PRODUCT_REF`:

- If `.env` already has a real product ref, verifies it and asks whether to keep it (`[Y/n]`).
- Otherwise lists products on your account (newest first, up to 10) and prompts you to pick one.
- With a single product, confirms with `Use "<name>" (prd_xxx)? [Y/n]`.
- With multiple products, shows a numbered list and accepts `[1-N]` (default `1`).
- With `--yes` or in non-interactive mode, auto-picks the newest product.
- With zero products, warns and points to [SolvaPay Console → Products](https://app.solvapay.com/products) — init still completes.

The chosen ref is written to `.env`. A scaffold placeholder (`__SOLVAPAY_PRODUCT_REF__`) or a missing ref triggers the picker automatically.
