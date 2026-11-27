---
'@solvapay/agents': minor
---

MPP on the HTTP gate (preview, off unless the merchant passes `mpp`). A call with no SolvaPay key gets a 402 with SolvaPay's MPP challenge (`mpp_challenge`); a paid credential is checked by SolvaPay and the call goes ahead on the payer's SolvaPay key, with `Payment-Receipt` and, on a first payment, `SolvaPay-Agent-Key`. The new payer's key also comes back when its first call is still refused (`paid` on `refused` and `rejected`, taken by `refusalResponse`), with the next challenge, or on `MppPaidCallError`.
