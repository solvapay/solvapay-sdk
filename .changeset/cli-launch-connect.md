---
'solvapay': minor
---

`solvapay launch <claude|hermes> <merchant>` starts Claude Code or Hermes on a merchant that takes SolvaPay agent payments, paying with an agent key its owner approved on their phone or in a browser; `solvapay connect <merchant> --client <claude|hermes>` (its launch name or `prov_…` reference) is the same connection made by an agent itself, as one command run again until it says connected (the preview's `connect start` and `connect finish`). Both moved here from the preview `@solvapay/agents` package, whose `solvapay-agents` bin now points at them.
