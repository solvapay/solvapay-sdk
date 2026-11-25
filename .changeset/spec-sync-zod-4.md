---
'@solvapay/server': patch
---

The generated API types follow the platform's spec, which now matches what the API accepts: `timestamp` on a usage event (`CreateUsageRequest`, and each event in `BulkCreateUsageRequest`) is optional; the API stamps the event when it is left out.
