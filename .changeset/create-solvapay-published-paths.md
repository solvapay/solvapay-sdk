---
'create-solvapay': patch
---

The next-auth0 starter now finds its template from the published package. `--openapi` accepts http(s) URLs and relative local paths, and non-spec URLs fail with a clear error instead of a filesystem ENOENT.
