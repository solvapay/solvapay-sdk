import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './paths.js'

const BUCKETS = ['shared', 'codegen', 'conformance', 'repo'] as const

const RELATIVE_IMPORT = /(?:from|import|export)\s+(?:type\s+)?(?:.+\s+from\s+)?['"](\.[^'"]+)['"]/g

function toolsRoot(): string {
  return path.join(REPO_ROOT, 'tools')
}

function listSource(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) {
    return acc
  }
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'target' || name === 'node_modules') {
        continue
      }
      if (existsSync(path.join(full, 'Cargo.toml'))) {
        continue
      }
      listSource(full, acc)
      continue
    }
    if (name.endsWith('.ts') || name.endsWith('.mjs')) {
      acc.push(full)
    }
  }
  return acc
}

function bucketOf(abs: string): string | undefined {
  const rel = path.relative(toolsRoot(), abs).split(path.sep).join('/')
  const top = rel.split('/')[0]
  if (top !== undefined && (BUCKETS as readonly string[]).includes(top)) {
    return top
  }
  return undefined
}

describe('tools bucket boundaries', () => {
  it('has the four bucket directories', () => {
    for (const bucket of BUCKETS) {
      expect(existsSync(path.join(toolsRoot(), bucket)), bucket).toBe(true)
    }
  })

  it('keeps relative imports inside the bucket or pointing at shared/', () => {
    const violations: string[] = []
    for (const file of listSource(toolsRoot())) {
      const fromBucket = bucketOf(file)
      if (fromBucket === undefined) {
        continue
      }
      const src = readFileSync(file, 'utf8')
      RELATIVE_IMPORT.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = RELATIVE_IMPORT.exec(src)) !== null) {
        const spec = match[1]
        if (spec === undefined) {
          continue
        }
        const resolved = path.resolve(path.dirname(file), spec)
        const relFromTools = path.relative(toolsRoot(), resolved).split(path.sep).join('/')
        if (relFromTools.startsWith('..')) {
          continue
        }
        const toBucket = bucketOf(resolved)
        if (toBucket === undefined) {
          continue
        }
        if (toBucket !== fromBucket && toBucket !== 'shared') {
          const relFile = path.relative(REPO_ROOT, file).split(path.sep).join('/')
          violations.push(`${relFile}: ${spec} -> ${toBucket}/`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
