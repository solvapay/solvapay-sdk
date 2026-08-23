import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INTERNAL_PACKAGE_IDS,
  REPO_ROOT,
  TOOL_PACKAGE_IDS,
  TS_PACKAGE_IDS,
  internalPackageDir,
  joinRel,
  toolPackageDir,
  tsPackageDir,
  type InternalPackageId,
  type ToolPackageId,
  type TsPackageId,
} from '../shared/paths.js'

type WorkspacePkg = {
  id: string
  kind: 'ts' | 'tool' | 'internal'
  dir: string
  rel: string
}

const RELATIVE_IMPORT =
  /(?:from|import|export)\s+(?:type\s+)?(?:[^'"\n]+\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', 'build'])

function posixRel(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/')
}

function targetDirectory(pkg: WorkspacePkg): string {
  if (pkg.kind === 'ts') {
    return `sdks/typescript/${pkg.id}`
  }
  if (pkg.kind === 'tool') {
    return `tools/${pkg.id}`
  }
  return `internal/${pkg.id}`
}

function workspacePackages(): WorkspacePkg[] {
  const out: WorkspacePkg[] = []
  for (const id of TS_PACKAGE_IDS) {
    out.push({
      id,
      kind: 'ts',
      dir: tsPackageDir(id as TsPackageId),
      rel: posixRel(tsPackageDir(id as TsPackageId)),
    })
  }
  for (const id of TOOL_PACKAGE_IDS) {
    out.push({
      id,
      kind: 'tool',
      dir: toolPackageDir(id as ToolPackageId),
      rel: posixRel(toolPackageDir(id as ToolPackageId)),
    })
  }
  for (const id of INTERNAL_PACKAGE_IDS) {
    out.push({
      id,
      kind: 'internal',
      dir: internalPackageDir(id as InternalPackageId),
      rel: posixRel(internalPackageDir(id as InternalPackageId)),
    })
  }
  return out.filter(pkg => existsSync(pkg.dir))
}

function ownerOf(abs: string, packages: WorkspacePkg[]): WorkspacePkg | undefined {
  const matches = packages.filter(
    pkg => abs === pkg.dir || abs.startsWith(pkg.dir + path.sep),
  )
  matches.sort((a, b) => b.dir.length - a.dir.length)
  return matches[0]
}

function listFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) {
    return acc
  }
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue
    }
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      listFiles(full, acc)
      continue
    }
    acc.push(full)
  }
  return acc
}

function readJsonObject(file: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${file}: expected a JSON object`)
  }
  return raw as Record<string, unknown>
}

describe('workspace package locality', () => {
  const packages = workspacePackages()

  it('does not extend a shared tsconfig via a relative path', () => {
    const violations: string[] = []
    for (const pkg of packages) {
      const file = path.join(pkg.dir, 'tsconfig.json')
      if (!existsSync(file)) {
        continue
      }
      const json = readJsonObject(file)
      const extendsValue = json.extends
      if (typeof extendsValue !== 'string' || !extendsValue.startsWith('.')) {
        continue
      }
      const resolved = path.resolve(path.dirname(file), extendsValue)
      const owner = ownerOf(resolved, packages)
      if (owner === undefined || owner.rel !== pkg.rel) {
        violations.push(`${posixRel(file)}: extends ${extendsValue}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('does not import another workspace package via a relative specifier', () => {
    const violations: string[] = []
    for (const pkg of packages) {
      for (const file of listFiles(pkg.dir)) {
        if (!/\.(ts|tsx|mjs)$/.test(file)) {
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
          const owner = ownerOf(resolved, packages)
          if (owner !== undefined && owner.rel !== pkg.rel) {
            violations.push(`${posixRel(file)}: ${spec} -> ${owner.rel}`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('sets repository.directory to the package layout path', () => {
    const violations: string[] = []
    for (const pkg of packages) {
      const pkgJsonPath = joinRel(pkg.dir, 'package.json')
      if (!existsSync(pkgJsonPath)) {
        continue
      }
      const json = readJsonObject(pkgJsonPath)
      const repository = json.repository
      if (typeof repository !== 'object' || repository === null || Array.isArray(repository)) {
        continue
      }
      const directory = (repository as Record<string, unknown>).directory
      if (typeof directory !== 'string') {
        continue
      }
      const expected = targetDirectory(pkg)
      if (directory !== expected) {
        violations.push(`${posixRel(pkgJsonPath)}: directory ${directory} !== ${expected}`)
      }
    }
    expect(violations).toEqual([])
  })
})
