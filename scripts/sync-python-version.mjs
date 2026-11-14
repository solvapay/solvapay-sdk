// Gives the Python package (python/) the version @solvapay/server has, so a
// release ships both at one version. Runs after `changeset version` in
// `pnpm changeset:version`. Updates pyproject.toml and the uv.lock files that
// record the package (CI installs with --locked, so they must agree).
//
// Plain Node, no uv needed: the release job has no Python.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(
  readFileSync(join(root, 'packages/server/package.json'), 'utf-8'),
).version

function replaceOnce(file, pattern, replacement) {
  const path = join(root, file)
  const text = readFileSync(path, 'utf-8')
  if (!pattern.test(text)) throw new Error(`${file}: no solvapay version found to update`)
  writeFileSync(path, text.replace(pattern, replacement))
}

replaceOnce('python/pyproject.toml', /^version = "[^"]+"$/m, `version = "${version}"`)
for (const lock of ['python/uv.lock', 'examples/python-stock-research-mcp/uv.lock']) {
  replaceOnce(lock, /(\nname = "solvapay"\nversion = )"[^"]+"/, `$1"${version}"`)
}
console.log(`Python package set to ${version}`)
