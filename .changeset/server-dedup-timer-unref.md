---
'@solvapay/server': patch
---

Node scripts, CLIs and jobs now exit after a customer lookup. The customer-lookup cache's cleanup timer no longer keeps the process alive.
