#!/usr/bin/env tsx

/**
 * Count lines of code across the SolvaPay SDK monorepo.
 *
 * By default, scans every TypeScript workspace package from the layout
 * manifest and breaks down the count into total / blank / comment / code
 * lines, separating production source from test files. Pass `--include-examples`
 * or `--include-tools` to widen the scope. Pass `--json` for machine-readable
 * output.
 *
 * Usage:
 *   pnpm tsx tools/repo/count-loc.ts
 *   pnpm tsx tools/repo/count-loc.ts --include-examples --include-tools
 *   pnpm tsx tools/repo/count-loc.ts --json
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  DOCS_DIR,
  EXAMPLES_DIR,
  INTERNAL_PACKAGE_IDS,
  TOOL_PACKAGE_IDS,
  TOOLS_DIR,
  TS_PACKAGE_IDS,
  internalPackageDir,
  internalPackageRel,
  toolPackageDir,
  toolPackageRel,
  tsPackageDir,
  tsPackageRel,
} from '../shared/paths.js'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.turbo',
  '.next',
  '.cache',
  'coverage',
  '.git',
])

type FileBucket = 'source' | 'test' | 'declaration'

type LineStats = {
  total: number
  blank: number
  comment: number
  code: number
}

type Counters = LineStats & { files: number }

type GroupCounters = {
  source: Counters
  test: Counters
  declaration: Counters
}

type Group = {
  label: string
  rootDir: string
}

const ARGS = new Set(process.argv.slice(2))
const JSON_OUTPUT = ARGS.has('--json')
const INCLUDE_EXAMPLES = ARGS.has('--include-examples')
const INCLUDE_TOOLS = ARGS.has('--include-tools')
const INCLUDE_DOCS = ARGS.has('--include-docs')

const emptyCounters = (): Counters => ({
  files: 0,
  total: 0,
  blank: 0,
  comment: 0,
  code: 0,
})

const emptyGroupCounters = (): GroupCounters => ({
  source: emptyCounters(),
  test: emptyCounters(),
  declaration: emptyCounters(),
})

const classifyFile = (relativePath: string): FileBucket => {
  if (relativePath.endsWith('.d.ts')) {
    return 'declaration'
  }
  const segments = relativePath.split(path.sep)
  if (segments.some(seg => seg === '__tests__' || seg === 'tests' || seg === '__mocks__')) {
    return 'test'
  }
  if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(relativePath)) {
    return 'test'
  }
  return 'source'
}

const countLines = (filePath: string): LineStats => {
  const content = readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  // `split` produces a trailing empty string when the file ends in a newline.
  // Drop it so the total reflects actual source lines, not file-terminator artefacts.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  let blank = 0
  let comment = 0
  let code = 0
  let inBlockComment = false

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (line === '') {
      blank += 1
      continue
    }

    if (inBlockComment) {
      comment += 1
      if (line.includes('*/')) {
        inBlockComment = false
      }
      continue
    }

    if (line.startsWith('//')) {
      comment += 1
      continue
    }

    if (line.startsWith('/*')) {
      comment += 1
      if (!line.includes('*/')) {
        inBlockComment = true
      }
      continue
    }

    code += 1
  }

  return { total: lines.length, blank, comment, code }
}

const accumulate = (target: Counters, stats: LineStats) => {
  target.files += 1
  target.total += stats.total
  target.blank += stats.blank
  target.comment += stats.comment
  target.code += stats.code
}

const walk = (dir: string, group: GroupCounters, groupRoot: string) => {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) {
      continue
    }
    const fullPath = path.join(dir, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      walk(fullPath, group, groupRoot)
      continue
    }

    if (!stats.isFile()) {
      continue
    }

    const ext = path.extname(entry)
    if (!SOURCE_EXTENSIONS.has(ext)) {
      continue
    }

    const relative = path.relative(groupRoot, fullPath)
    const bucket = classifyFile(relative)
    const fileStats = countLines(fullPath)
    accumulate(group[bucket], fileStats)
  }
}

const collectPackageGroups = (): Group[] => {
  const groups: Group[] = []
  for (const id of TS_PACKAGE_IDS) {
    groups.push({ label: tsPackageRel(id), rootDir: tsPackageDir(id) })
  }
  for (const id of TOOL_PACKAGE_IDS) {
    groups.push({ label: toolPackageRel(id), rootDir: toolPackageDir(id) })
  }
  for (const id of INTERNAL_PACKAGE_IDS) {
    groups.push({ label: internalPackageRel(id), rootDir: internalPackageDir(id) })
  }
  return groups
}

const collectAdditionalGroups = (): Group[] => {
  const groups: Group[] = []
  if (INCLUDE_EXAMPLES) {
    groups.push({ label: 'examples', rootDir: EXAMPLES_DIR })
  }
  if (INCLUDE_TOOLS) {
    groups.push({ label: 'tools', rootDir: TOOLS_DIR })
  }
  if (INCLUDE_DOCS) {
    groups.push({ label: 'docs', rootDir: DOCS_DIR })
  }
  return groups
}

const formatNumber = (value: number) => value.toLocaleString('en-US')

const buildTable = (rows: Array<{ label: string; counters: GroupCounters }>) => {
  const headers = ['Group', 'Files', 'Code', 'Comment', 'Blank', 'Total']

  type DisplayRow = {
    label: string
    files: number
    code: number
    comment: number
    blank: number
    total: number
  }

  const flatten = (label: string, counters: Counters): DisplayRow => ({
    label,
    files: counters.files,
    code: counters.code,
    comment: counters.comment,
    blank: counters.blank,
    total: counters.total,
  })

  const displayRows: DisplayRow[] = []
  const totals: GroupCounters = emptyGroupCounters()

  for (const { label, counters } of rows) {
    if (counters.source.files > 0) {
      displayRows.push(flatten(`${label} (src)`, counters.source))
    }
    if (counters.test.files > 0) {
      displayRows.push(flatten(`${label} (tests)`, counters.test))
    }
    if (counters.declaration.files > 0) {
      displayRows.push(flatten(`${label} (.d.ts)`, counters.declaration))
    }

    for (const bucket of ['source', 'test', 'declaration'] as const) {
      const totalsBucket = totals[bucket]
      const counterBucket = counters[bucket]
      totalsBucket.files += counterBucket.files
      totalsBucket.total += counterBucket.total
      totalsBucket.blank += counterBucket.blank
      totalsBucket.comment += counterBucket.comment
      totalsBucket.code += counterBucket.code
    }
  }

  const grandTotal = emptyCounters()
  for (const bucket of ['source', 'test', 'declaration'] as const) {
    grandTotal.files += totals[bucket].files
    grandTotal.total += totals[bucket].total
    grandTotal.blank += totals[bucket].blank
    grandTotal.comment += totals[bucket].comment
    grandTotal.code += totals[bucket].code
  }

  displayRows.push(flatten('TOTAL src', totals.source))
  displayRows.push(flatten('TOTAL tests', totals.test))
  if (totals.declaration.files > 0) {
    displayRows.push(flatten('TOTAL .d.ts', totals.declaration))
  }
  displayRows.push(flatten('GRAND TOTAL', grandTotal))

  const stringRows = displayRows.map(row => [
    row.label,
    formatNumber(row.files),
    formatNumber(row.code),
    formatNumber(row.comment),
    formatNumber(row.blank),
    formatNumber(row.total),
  ])

  const widths = headers.map((header, i) =>
    Math.max(header.length, ...stringRows.map(r => r[i].length)),
  )

  const renderRow = (cells: string[]) =>
    cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ')

  const separator = widths.map(w => '-'.repeat(w)).join('  ')

  const out: string[] = []
  out.push(renderRow(headers))
  out.push(separator)
  for (const row of stringRows) {
    out.push(renderRow(row))
    if (row[0].startsWith('TOTAL ') || row[0] === 'GRAND TOTAL') {
      out.push(separator)
    }
  }
  return out.join('\n')
}

const main = () => {
  const groups = [...collectPackageGroups(), ...collectAdditionalGroups()]

  const rows = groups.map(group => {
    const counters = emptyGroupCounters()
    walk(group.rootDir, counters, group.rootDir)
    return { label: group.label, counters }
  })

  if (JSON_OUTPUT) {
    const payload = rows.map(({ label, counters }) => ({ label, ...counters }))
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return
  }

  process.stdout.write(`${buildTable(rows)}\n`)
}

main()
