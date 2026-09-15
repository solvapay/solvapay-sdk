import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REPO_PATHS,
  REPO_ROOT,
  TS_PACKAGE_IDS,
  tsPackageDir,
  type TsPackageId,
} from '../shared/paths.js'

type ExportTarget = string | Record<string, string>
type ExportMap = Record<string, ExportTarget>

type PkgJson = {
  name: string
  exports?: ExportMap
  sideEffects?: boolean | string[]
  publishConfig?: {
    access?: string
    exports?: ExportMap
  }
}

function readPkg(id: TsPackageId): PkgJson {
  const raw = readFileSync(path.join(tsPackageDir(id), 'package.json'), 'utf8')
  return JSON.parse(raw) as PkgJson
}

function conditionsOf(target: ExportTarget | undefined): string[] {
  if (!target || typeof target === 'string') return []
  return Object.keys(target)
}

function hasDevelopmentCondition(exports: ExportMap | undefined): boolean {
  if (!exports) return false
  return Object.values(exports).some(target => conditionsOf(target).includes('development'))
}

describe('published export maps', () => {
  it('strips development conditions and keeps every subpath when the workspace map uses development', () => {
    const offenders: string[] = []

    for (const id of TS_PACKAGE_IDS) {
      const pkg = readPkg(id)
      if (!hasDevelopmentCondition(pkg.exports)) continue

      const published = pkg.publishConfig?.exports
      if (!published) {
        offenders.push(`${pkg.name}: has a development condition but no publishConfig.exports`)
        continue
      }

      const workspaceSubpaths = Object.keys(pkg.exports ?? {})
      const publishedSubpaths = Object.keys(published)
      for (const subpath of workspaceSubpaths) {
        if (!publishedSubpaths.includes(subpath)) {
          offenders.push(`${pkg.name}: publishConfig.exports is missing ${subpath}`)
        }
      }

      for (const [subpath, target] of Object.entries(published)) {
        if (conditionsOf(target).includes('development')) {
          offenders.push(`${pkg.name}: publishConfig.exports[${subpath}] still has development`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('gives @solvapay/core ./browser-wasm a development condition so dev bundlers share one module instance', () => {
    const pkg = readPkg('core')
    const browserWasm = pkg.exports?.['./browser-wasm']
    expect(browserWasm).toBeTypeOf('object')
    expect((browserWasm as Record<string, string>).development).toBe('./src/browser-wasm.ts')
    expect(pkg.sideEffects).toContain('./src/browser-wasm.ts')
  })
})

describe('@solvapay/server-wasm publish metadata', () => {
  const pkgPath = path.join(REPO_ROOT, REPO_PATHS.sdks.wasm, 'package.json')
  const pkgDir = path.dirname(pkgPath)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    name: string
    license?: string
    files?: string[]
    publishConfig?: { access?: string }
    repository?: { directory?: string }
  }

  it('is public on npm with a repository directory and license', () => {
    expect(pkg.name).toBe('@solvapay/server-wasm')
    expect(pkg.publishConfig?.access).toBe('public')
    expect(pkg.repository?.directory).toBe(REPO_PATHS.sdks.wasm)
    expect(pkg.license).toBeTruthy()
  })

  it('packs only paths that exist on disk', () => {
    expect(pkg.files).toBeDefined()
    const missing = (pkg.files ?? []).filter(rel => !existsSync(path.join(pkgDir, rel)))
    expect(missing).toEqual([])
  })
})
