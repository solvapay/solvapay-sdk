---
'@solvapay/init': minor
---

Independent CLI updates for `solvapay init` (secret overwrite and related prompts).

`solvapay init` warns when it writes a live secret key, and a non-interactive re-run refuses to overwrite an existing key unless `--yes` is passed. Non-interactive runs without `--product` say that deploy fails until the product placeholder is replaced.

`classifySecretKey` classifies a secret key as live, sandbox, legacy test, or unknown, and reports whether the value is still a placeholder.
