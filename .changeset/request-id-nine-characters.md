---
'@solvapay/server': patch
---

A paywall request id always ends in nine random characters, drawn from Web Crypto as the Go and Python SDKs draw theirs. Now and then it had fewer: `Math.random().toString(36)` can come out short.
