#!/usr/bin/env node
/**
 * Preview publish step, run right after `changeset version --snapshot preview`:
 * give a snapshot version to every package whose manifest now points at a
 * snapshot but whose own version was left alone, so it is published with
 * the rest of the preview.
 *
 * Why this exists:
 *
 * With `onlyUpdatePeerDependentsWhenOutOfRange`, a snapshot of a package
 * moves its dependents' peer ranges to the exact snapshot version (a
 * pre-release never satisfies `^0.6.0`), but it does not bump the dependent
 * itself. `changeset publish` then skips the dependent because its version
 * is already on npm, and the dependent's `@preview` tag keeps pointing at an
 * older snapshot that pins the older snapshot of the package.
 *
 * Found 16 Nov 2026: `@solvapay/react@preview` was
 * `2.7.2-preview-0b146053…` and peered on exactly
 * `@solvapay/mcp-core@0.6.0-preview-0b146053…`, while `@solvapay/mcp-core@preview`
 * had moved on. Every `npm create solvapay@preview -- --type mcp` project
 * failed `npm install` with ERESOLVE. A real release does bump the dependent;
 * only the snapshot path skips it.
 *
 * What it does, repeated until nothing changes:
 *   - a public package whose dependencies, peers or optional dependencies
 *     name an internal package by anything other than `workspace:` or that
 *     package's exact snapshot version gets the exact version (a range never
 *     matches a pre-release), as Changesets does for the packages it bumps;
 *   - a public package that now pins a snapshot but is not one itself gets
 *     `<next patch>-preview-<commit>`, the same form Changesets gives the
 *     others.
 * Then it checks that every exact internal pin names the version in the
 * workspace, and exits 1 if one does not.
 *
 * `workspace:` specs are left to pnpm, which writes the version at publish.
 * Exits 0 without changes when the snapshot bumped nothing.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SNAPSHOT_RE = /-preview-([0-9a-f]{7,40})$/
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies']

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

function listPackages() {
  const dir = join(ROOT, 'packages')
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(dir, entry.name, 'package.json')
    if (statSync(path, { throwIfNoEntry: false })?.isFile())
      out.push({ path, json: readJson(path) })
  }
  return out
}

function isIgnored(pkg, ignore) {
  if (pkg.private === true) return true
  return ignore.some(pattern =>
    pattern.endsWith('/*')
      ? pkg.name?.startsWith(`${pattern.slice(0, -2)}/`)
      : pkg.name === pattern,
  )
}

function nextPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`Cannot take the next patch of "${version}": expected x.y.z`)
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

function main() {
  const config = readJson(join(ROOT, '.changeset', 'config.json'))
  const ignore = Array.isArray(config.ignore) ? config.ignore : []
  const packages = listPackages().filter(pkg => pkg.json.name && !isIgnored(pkg.json, ignore))
  const byName = new Map(packages.map(pkg => [pkg.json.name, pkg]))

  const commits = new Set(
    packages.map(pkg => SNAPSHOT_RE.exec(pkg.json.version)?.[1]).filter(Boolean),
  )
  if (commits.size === 0) {
    console.log('No snapshot versions in the workspace: nothing to do.')
    return
  }
  if (commits.size > 1) {
    throw new Error(`Snapshot versions name more than one commit: ${[...commits].join(', ')}`)
  }
  const [commit] = commits
  const isSnapshot = version => SNAPSHOT_RE.test(version)

  const changed = new Set()
  const bumped = []
  for (let pass = 0; ; pass++) {
    if (pass > packages.length) throw new Error('Snapshot dependents did not settle')
    let progress = false
    for (const pkg of packages) {
      for (const field of DEP_FIELDS) {
        for (const [name, spec] of Object.entries(pkg.json[field] ?? {})) {
          const target = byName.get(name)
          if (!target || !isSnapshot(target.json.version)) continue
          if (spec.startsWith('workspace:') || spec === target.json.version) continue
          pkg.json[field][name] = target.json.version
          changed.add(pkg)
          progress = true
        }
      }
      const pinsSnapshot = DEP_FIELDS.some(field =>
        Object.values(pkg.json[field] ?? {}).some(spec => isSnapshot(spec)),
      )
      if (pinsSnapshot && !isSnapshot(pkg.json.version)) {
        const from = pkg.json.version
        pkg.json.version = `${nextPatch(from)}-preview-${commit}`
        bumped.push(`${pkg.json.name} ${from} -> ${pkg.json.version}`)
        changed.add(pkg)
        progress = true
      }
    }
    if (!progress) break
  }

  const stale = []
  for (const pkg of packages) {
    for (const field of DEP_FIELDS) {
      for (const [name, spec] of Object.entries(pkg.json[field] ?? {})) {
        const target = byName.get(name)
        if (target && isSnapshot(spec) && spec !== target.json.version) {
          stale.push(
            `${pkg.json.name} ${field}.${name} = ${spec}, workspace has ${target.json.version}`,
          )
        }
      }
    }
  }
  if (stale.length > 0) {
    throw new Error(`Snapshot pins that name the wrong version:\n  ${stale.join('\n  ')}`)
  }

  for (const pkg of changed) writeFileSync(pkg.path, `${JSON.stringify(pkg.json, null, 2)}\n`)
  if (bumped.length === 0) {
    console.log('Every package that pins a snapshot has one.')
    return
  }
  console.log('Snapshot versions for packages whose dependencies moved:')
  for (const line of bumped) console.log(`  ${line}`)
  for (const pkg of changed) console.log(`  wrote ${relative(ROOT, pkg.path)}`)
}

main()
