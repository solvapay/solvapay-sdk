---
"@solvapay/init": patch
"solvapay": patch
---

`solvapay init` warns when it writes a live secret key, and a non-interactive re-run refuses to overwrite an existing key unless `--yes` is passed. Non-interactive runs without `--product` say that deploy fails until the product placeholder is replaced.
