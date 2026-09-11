---
'@solvapay/server': patch
---

Python `SolvaPay.track_usage` now mirrors Ruby: it posts usage through the same retry path as `payable` handlers.
