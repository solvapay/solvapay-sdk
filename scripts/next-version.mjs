// Prints the next release of a version-source package (python/ or go/): its
// package.json version bumped by the largest pending changeset that names it,
// the same bump `changeset version` will make. With none pending it is the next
// patch, so a preview made after a release still sorts after it.
//
// The publish workflows add their own pre-release suffix: Python <next>.devN
// (PEP 440), Go v<next>-dev.N (semver). Both sort before <next> and after every
// earlier release.
//
//   node scripts/next-version.mjs python
//   node scripts/next-version.mjs go
//
// Plain Node, no dependencies: the publish jobs install nothing for it.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = process.argv[2]
if (!dir || process.argv.length !== 3) {
  throw new Error('usage: node scripts/next-version.mjs <python|go>')
}

const { name, version } = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf-8'))
const release = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
if (!release) throw new Error(`${dir}/package.json version ${version} is not MAJOR.MINOR.PATCH`)

const BUMPS = ['patch', 'minor', 'major']
const entry = /^\s*['"]?([^'":]+)['"]?\s*:\s*(patch|minor|major)\s*$/
let largest = -1
for (const file of readdirSync(join(root, '.changeset')).sort()) {
  if (!file.endsWith('.md') || file === 'README.md') continue
  const parts = readFileSync(join(root, '.changeset', file), 'utf-8').split('---')
  if (parts.length < 3) throw new Error(`.changeset/${file}: no changeset frontmatter`)
  for (const line of parts[1].split('\n')) {
    const match = entry.exec(line)
    if (match && match[1] === name) largest = Math.max(largest, BUMPS.indexOf(match[2]))
  }
}

const [major, minor, patch] = release.slice(1).map(Number)
const bump = BUMPS[Math.max(largest, 0)]
console.log(
  bump === 'major'
    ? `${major + 1}.0.0`
    : bump === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`,
)
