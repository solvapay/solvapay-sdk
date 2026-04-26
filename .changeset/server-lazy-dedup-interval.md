---
'@solvapay/server': patch
---

`createRequestDeduplicator` now starts its background cleanup interval
on first `deduplicate()` call instead of at construction time. Fixes a
hard-boot failure on Cloudflare Workers (and any other runtime that
forbids timers / async I/O in the global scope — see the Workers
"Disallowed operation called within global scope" error) when the
paywall's module-scope `sharedCustomerLookupDeduplicator` is
instantiated during Worker module load.

No observable behaviour change for existing Node / Deno / Supabase Edge
consumers: the cleanup interval was always driven by cache turnover,
and nothing is actually in the cache until the first `deduplicate()`
call anyway.
