---
'solvapay': patch
---

`solvapay connect` tells the owner that payments run in sandbox with test money and nothing real is charged while live payments aren't open. When SolvaPay refuses because the merchant doesn't take agent payments yet, or because live agent payments aren't open yet, `launch` and `connect` say so in a plain sentence instead of printing the raw 403. The README now shows the arguments the CLI takes: `--client <claude|hermes>` and the merchant's launch name or `prov_…` reference.
