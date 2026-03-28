# @solvapay/cli

SolvaPay CLI.

## Migration from `solvapay`

The npm package was renamed from `solvapay` to `@solvapay/cli`.
The command stays the same: `solvapay`.

## Usage

```bash
# Runs the scoped package and executes the `solvapay` command
npx @solvapay/cli init

# Equivalent command-style usage
npx solvapay init
```

## What `solvapay init` does

- Checks for `package.json` (and can create one if missing)
- Opens browser authentication and waits for approval
- Writes `SOLVAPAY_SECRET_KEY` to `.env` (with overwrite confirmation)
- Ensures `.env` is ignored in `.gitignore`
- Installs `@solvapay/server` and `@solvapay/core`
- Verifies the key and prints a quick-start snippet
