---
'@solvapay/react-supabase': patch
---

Republish `@solvapay/react-supabase` to skip past a corrupt `1.0.8` that landed on npm but was never tagged `@latest`. That earlier `1.0.8` was published while the workspace had a leftover `1.0.8` `version` field paired with a `workspace:^` `@solvapay/react` peerDep that resolved to a preview snapshot (`@solvapay/react@^1.0.11-preview-...`), so any consumer who happened to pin to it would pull a non-stable React build.

The recent `chore: version packages` release (April 2026) tried to republish `1.0.8` after the workspace versions were reset, but npm rejects duplicate version publishes and changesets-action silently skipped it — leaving the dist-tags `latest` pointer stuck at `1.0.7`. Bumping to `1.0.9` lets the next release land cleanly and move the `@latest` tag forward.

`1.0.8` should be deprecated on npm (`npm deprecate @solvapay/react-supabase@1.0.8 "broken peerDependency on a @solvapay/react preview snapshot; use ^1.0.9 instead"`).
