---
'@solvapay/server': patch
---

`saveAutoRechargeCore` saves auto-recharge for the verified user's customer even when the request body names another `customerRef`. It used to spread the client's input over the user's customer, so a signed-in user could change another customer's auto-recharge.
