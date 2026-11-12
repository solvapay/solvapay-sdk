---
'@solvapay/release-train': minor
---

Agent payments run in the Rust core. The client gains nine operations on every SDK (TypeScript, Python, Ruby, Go, Rust, C): `agentVerifyKey`, `agentAuthorize`, `agentComplete`, `agentReportUsage`, `agentIdentify`, `agentBeginCall`, `agentFinishCall`, `agentGate` and `agentMcpRoute`. The pure helpers behind them (strict response parsing, agent token claims, OAuth protected resource metadata and challenge, prompt facts, refusal statuses) are exported as core helpers. `@solvapay/agents` keeps its public API and takes every decision from the core.
