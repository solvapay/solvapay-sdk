---
'@solvapay/server': minor
---

`LimitResponse` now carries the resolved `onExceed` outcome as typed flags: `throttled`, `overage`, `needsTopUp`, `needsUpgrade`, and `upgraded`. They surface on `checkLimits` results and on `decision.limits` inside a `payable()` handler, so you no longer have to infer the outcome from the surrounding fields.

`throttled` and `overage` ride the **allow** path (`withinLimits: true`): the call is served, and your handler can degrade service or record that the usage accrued an overage charge. `needsTopUp`, `needsUpgrade`, and `upgraded` accompany a gate outcome — the first two block pending an auto-recharge top-up or a plan switch, and `upgraded` means the customer was auto-upgraded to the limit's target pricing to restore access.
