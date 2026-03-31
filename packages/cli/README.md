# solvapay

SolvaPay CLI.

## Usage

```bash
# Run the SolvaPay CLI init flow
npx solvapay init

# Skip browser confirmation prompt
npx solvapay init --yes
```

## What `solvapay init` does

- Checks for `package.json` (and can create one if missing)
- Shows auth URL and asks you to press Enter before opening browser authentication
- Writes `SOLVAPAY_SECRET_KEY` to `.env` (with overwrite confirmation)
- Ensures `.env` is ignored in `.gitignore`
- Installs `@solvapay/server` and `@solvapay/core`
- Verifies the key and prints a quick-start snippet
