---
'@solvapay/agents': patch
---

`createAgentMcpRoute` registers `freeTools` for a signed-in agent too, as documented ("signed in or not"). They were only registered for a host that had not signed in, so an agent lost the free tools once it connected (`Tool … not found`).
