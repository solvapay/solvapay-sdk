---
'@solvapay/server': patch
'@solvapay/core': patch
---

Re-export `verify_webhook` and public `withRetry` on the Rust, Python, and Go facades so those surfaces match TypeScript and Ruby. Remove the unused TypeScript `tax-jurisdictions.ts` data file.
