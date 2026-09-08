---
'@solvapay/mcp': patch
---

Python `auth_header_from_ctx` now reads Starlette `scope["auth"]` instead of the raising `Request.auth` property, so anonymous `tools/list` no longer 500s when AuthenticationMiddleware is not installed.
