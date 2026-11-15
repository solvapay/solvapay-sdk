---
'solvapay': patch
'create-solvapay': patch
---

`solvapay` and `create-solvapay` depend on the exact `@solvapay/init` version they were released with. With a caret range, a preview build (`…-preview-<commit sha>`) resolved `@solvapay/init` to the preview whose commit sha sorts last alphabetically, not its own, and failed to start when that build lacked an export it uses.
