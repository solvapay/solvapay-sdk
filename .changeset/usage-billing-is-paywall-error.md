---
'@solvapay/server': patch
---

Go and Rust `TrackFail` now skip usage when the cause is a paywall error (same as TypeScript, Python, and Ruby). Direct `trackUsageCore` posts now use the same customer-not-found retry schedule as the gate driver.
