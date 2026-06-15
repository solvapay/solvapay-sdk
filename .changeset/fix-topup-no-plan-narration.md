---
"@solvapay/mcp-core": patch
---

`manage_account` narration no longer treats credit top-ups as an active plan and shows the customer's balance in the no-plan welcome path so credited-but-planless users are routed to `activate_plan`.
