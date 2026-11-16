# AGENTS.md — conformance/

The contract every SDK is judged by. It belongs to the TypeScript SDK, the
reference. See README.md for the case format.

- **Only work here from a TypeScript change.** Never edit a case to make another
  language pass. If a language disagrees with a case, fix the language, or raise
  it as a TypeScript bug.
- **Write the input and description, then record.** `expect` comes from
  `pnpm --filter @solvapay/conformance-typescript record`, never from typing it.
  Read what was recorded before committing.
- **`cases.lock` is written only by `record`.** The TypeScript tests fail when it
  is stale. Never edit it by hand.
- **To change an expectation on purpose**, edit it by hand so it shows in review,
  then run `record` to refresh the lock.
- A new operation (`fn`) needs a mapping in `runners/typescript/src/`. Other
  languages add theirs when they adopt the case.
- Don't change a case and a language folder in the same PR: the "Contract
  boundary" check fails it.
- **Read cases compactly.** The files are pretty JSON for review; reading them
  that way costs ~40% more tokens than needed. Use `node conformance/show.mjs`:
  `--list [suite]` for names and descriptions, `--keys <suite>/<case>` for a
  case's shape, `<suite>/<case>` for the whole case minified, and
  `<suite>/<case> <path>` for one part (`expect`, `steps.2.expect.apiCalls`).
  Open the file itself only to edit it.
