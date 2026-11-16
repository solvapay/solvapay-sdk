#!/usr/bin/env node
// Prints conformance cases compactly, for reading them with fewer tokens.
// The files stay pretty JSON on disk (reviewable, diffable); this only changes
// how they are read. Minified output is ~29% fewer tokens than the files.
//
//   node conformance/show.mjs <suite>/<case>            the whole case, minified
//   node conformance/show.mjs <suite>/<case> <path>     one part: input.args, expect, steps.2.expect.apiCalls
//   node conformance/show.mjs --list [suite]            case names with their descriptions
//   node conformance/show.mjs --keys <suite>/<case>     the case's shape: keys and sizes, no values
//
// A case may be named by its path too (conformance/cases/<suite>/<case>.json).
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CASES = join(dirname(fileURLToPath(import.meta.url)), 'cases')

function fail(message) {
  console.error(`show: ${message}`)
  process.exit(1)
}

function load(name) {
  const clean = name.replace(/^.*cases\//, '').replace(/\.json$/, '')
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(clean))
    fail(`not a case name: ${name} (want <suite>/<case>)`)
  try {
    return JSON.parse(readFileSync(join(CASES, `${clean}.json`), 'utf8'))
  } catch (error) {
    fail(`${clean}: ${error.message}`)
  }
}

function pick(value, path) {
  let current = value
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || !(part in current)) {
      fail(`no ${path}: stopped at "${part}"`)
    }
    current = current[part]
  }
  return current
}

function shape(value, depth = 0) {
  if (Array.isArray(value))
    return depth > 2 ? `[${value.length}]` : value.map(v => shape(v, depth + 1))
  if (value && typeof value === 'object') {
    if (depth > 2) return `{${Object.keys(value).length} keys}`
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]))
  }
  return typeof value === 'string' && value.length > 40 ? `string(${value.length})` : value
}

const [first, second] = process.argv.slice(2)
if (!first || first === '--help' || first === '-h') {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\nimport')[0]
      .replace(/^#!.*\n/, ''),
  )
  process.exit(first ? 0 : 1)
}
if (first === '--list') {
  const suites = second ? [second] : readdirSync(CASES).sort()
  for (const suite of suites) {
    let files
    try {
      files = readdirSync(join(CASES, suite)).sort()
    } catch {
      fail(`no suite ${suite}`)
    }
    for (const file of files) {
      const data = load(`${suite}/${file}`)
      console.log(`${suite}/${data.case}: ${data.description}`)
    }
  }
} else if (first === '--keys') {
  if (!second) fail('--keys needs a case')
  console.log(JSON.stringify(shape(load(second))))
} else {
  const data = load(first)
  console.log(JSON.stringify(second ? pick(data, second) : data))
}
