---
'solvapay': patch
---

`solvapay launch` and `connect` are marked as a preview in the help and the README. `connect` tells the owner that agent payments run in sandbox with test money and nothing real is charged. When SolvaPay refuses because the merchant hasn't turned on agent payments, or because live agent payments aren't open yet, the CLI says so in a plain sentence instead of printing the raw 403. The README now shows the arguments the CLI takes: `--client <claude|hermes>` and the merchant's launch name or `prov_…` reference.
