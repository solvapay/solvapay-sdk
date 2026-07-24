/**
 * Surgical YAML block editors for sdk-contract.yaml.
 *
 * Preserves surrounding formatting — never round-trips the whole document.
 */

import { stringify } from 'yaml'

/** Bounds of a `  entryId:` block through the line before the next sibling / section. */
export function entryBounds(text: string, entryId: string): { start: number; end: number } {
  const startRe = new RegExp(`^  ${entryId}:\\n`, 'm')
  const startMatch = startRe.exec(text)
  if (startMatch === null) {
    throw new Error(`Entry not found: ${entryId}`)
  }
  const contentStart = startMatch.index + startMatch[0].length
  const rest = text.slice(contentStart)
  const nextRe = /^(?:  [A-Za-z]|[A-Za-z])/m
  const nextMatch = nextRe.exec(rest)
  const end = nextMatch === null ? text.length : contentStart + nextMatch.index
  return { start: startMatch.index, end }
}

/** Whether `  entryId:` already exists as a top-level-under-section key. */
export function hasEntry(text: string, entryId: string): boolean {
  return new RegExp(`^  ${entryId}:\\n`, 'm').test(text)
}

/**
 * Insert YAML immediately before the entry's `    sync:` line.
 * If `replaceKey` is set and already present, replace that block instead.
 */
export function insertBeforeSync(
  text: string,
  entryId: string,
  insert: string,
  options?: { replaceKey?: string },
): string {
  const { start, end } = entryBounds(text, entryId)
  const full = text.slice(start, end)
  const replaceKey = options?.replaceKey
  if (replaceKey !== undefined) {
    const keyRe = new RegExp(`^    ${replaceKey}:`, 'm')
    if (keyRe.test(full)) {
      const replaced = full.replace(
        new RegExp(`^    ${replaceKey}:[\\s\\S]*?(?=^    sync:)`, 'm'),
        insert,
      )
      return text.slice(0, start) + replaced + text.slice(end)
    }
  }
  if (!/^    sync:/m.test(full)) {
    throw new Error(`No sync: block in ${entryId}`)
  }
  const withInsert = full.replace(/^    sync:/m, `${insert}    sync:`)
  return text.slice(0, start) + withInsert + text.slice(end)
}

/** Render a YAML fragment at the given indent (spaces). */
export function renderYamlFragment(value: unknown, indent: number): string {
  const pad = ' '.repeat(indent)
  const rendered = stringify(value, {
    lineWidth: 0,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'PLAIN',
  })
  return (
    rendered
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => `${pad}${line}`)
      .join('\n') + '\n'
  )
}

/**
 * Locate a top-level section (`operations:`, `bindings:`, …) and return the
 * absolute offsets of its body (after the header line through next top-level key).
 */
export function sectionBounds(
  text: string,
  sectionName: string,
): { headerStart: number; bodyStart: number; bodyEnd: number } {
  const headerRe = new RegExp(`^${sectionName}:\\n`, 'm')
  const headerMatch = headerRe.exec(text)
  if (headerMatch === null) {
    throw new Error(`Section not found: ${sectionName}`)
  }
  const bodyStart = headerMatch.index + headerMatch[0].length
  const rest = text.slice(bodyStart)
  const nextRe = /^[A-Za-z]/m
  const nextMatch = nextRe.exec(rest)
  const bodyEnd = nextMatch === null ? text.length : bodyStart + nextMatch.index
  return { headerStart: headerMatch.index, bodyStart, bodyEnd }
}

/**
 * Insert a new `  entryId:\n<body>` under a top-level section, alphabetically
 * among existing siblings when possible; otherwise append at end of section.
 */
export function insertSectionEntry(
  text: string,
  sectionName: string,
  entryId: string,
  bodyYaml: string,
): string {
  if (hasEntry(text, entryId)) {
    throw new Error(`Entry already exists: ${entryId}`)
  }
  const { bodyStart, bodyEnd } = sectionBounds(text, sectionName)
  const sectionBody = text.slice(bodyStart, bodyEnd)
  const entryBlock = `  ${entryId}:\n${bodyYaml}`

  // Find alphabetical insert point among `  foo:` keys.
  const keyRe = /^  ([A-Za-z][A-Za-z0-9_]*):$/gm
  let insertAt = bodyEnd
  let match: RegExpExecArray | null
  while ((match = keyRe.exec(sectionBody)) !== null) {
    const siblingId = match[1]
    if (siblingId === undefined) {
      continue
    }
    if (siblingId.localeCompare(entryId) > 0) {
      insertAt = bodyStart + match.index
      break
    }
  }

  // Ensure trailing newline before next section when appending.
  const prefix = text.slice(0, insertAt)
  const suffix = text.slice(insertAt)
  const needsLeadingNl = prefix.length > 0 && !prefix.endsWith('\n')
  const block = `${needsLeadingNl ? '\n' : ''}${entryBlock}${entryBlock.endsWith('\n') ? '' : '\n'}`
  return prefix + block + suffix
}

/**
 * Insert `'value',` into a TS `export const Name = [ … ]` array, alphabetically
 * among existing quoted string entries (comment lines are preserved).
 */
export function insertIntoStringArrayConst(
  source: string,
  constName: string,
  value: string,
): string {
  const constRe = new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\n\\]`)
  const match = constRe.exec(source)
  if (match === null) {
    throw new Error(`Const array not found: ${constName}`)
  }
  const body = match[1] ?? ''
  if (body.includes(`'${value}'`) || body.includes(`"${value}"`)) {
    return source
  }

  const lineRe = /^(\s*)(?:\/\/.*|['"]([^'"]+)['"],?)\s*$/gm
  let insertOffset: number | null = null
  let matchLine: RegExpExecArray | null
  while ((matchLine = lineRe.exec(body)) !== null) {
    const entry = matchLine[2]
    if (entry === undefined) {
      continue
    }
    if (entry.localeCompare(value) > 0) {
      insertOffset = matchLine.index
      break
    }
  }

  const line = `  '${value}',\n`
  const at = insertOffset === null ? body.length : insertOffset
  const nextBody = body.slice(0, at) + line + body.slice(at)
  return (
    source.slice(0, match.index) +
    `export const ${constName} = [${nextBody}\n]` +
    source.slice(match.index + match[0].length)
  )
}
