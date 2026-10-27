---
'create-solvapay': patch
---

Swagger 2.0 specs generate working tools. Parameters are typed from their own `type` / `format` instead of all becoming strings, `in: body` parameters are sent upstream as the JSON request body, and tools with a body always send `content-type: application/json`, including when the upstream needs no auth.
