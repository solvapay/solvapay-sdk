# solvapay

SolvaPay CLI.

## Usage

```bash
# Run the SolvaPay CLI init flow
npx solvapay init
```

## What `solvapay init` does

- Checks for `package.json` (and can create one if missing)
- Opens browser authentication and waits for approval
- Writes `SOLVAPAY_SECRET_KEY` to `.env` (with overwrite confirmation)
- Ensures `.env` is ignored in `.gitignore`
- Installs `@solvapay/server` and `@solvapay/core`
- Verifies the key and prints a quick-start snippet
