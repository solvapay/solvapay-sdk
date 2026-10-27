---
'create-solvapay': patch
---

Swagger 2.0 form operations generate working tools: `in: formData` fields are sent URL-encoded (or as multipart when the operation only accepts multipart), and `type: file` fields are left out of the tool input, with `describe.mjs` suggesting `skip` for those operations. Array request bodies are typed as arrays. `describe.mjs` and the project's `test.mjs` now put sample request bodies under `body`, matching the generated tool input.
