import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import { readTsSurface } from './ts-surface.js'

type PublicSurfaceSnapshot = {
  portableExports: string[]
  solvaPayMethods: string[]
  createSolvaPayConfig: string[]
}

const SNAPSHOT_REL = 'sdks/typescript/server/src/types/__tests__/public-surface.snapshot.json'

describe('published public surface snapshot', () => {
  const snapshot = JSON.parse(
    readFileSync(path.join(REPO_ROOT, SNAPSHOT_REL), 'utf8'),
  ) as PublicSurfaceSnapshot
  const surface = readTsSurface(REPO_ROOT)

  it('workspace portable exports are a superset of the published tarball', () => {
    const missing = snapshot.portableExports.filter(name => !surface.portableExports.has(name))
    expect(missing).toEqual([])
  })

  it('workspace facade methods are a superset of published SolvaPay methods', () => {
    const missing = snapshot.solvaPayMethods.filter(name => !surface.facadeMethods.has(name))
    expect(missing).toEqual([])
  })

  it('pins limitsCacheTTL as a published constructor option', () => {
    expect(snapshot.createSolvaPayConfig).toContain('limitsCacheTTL')
  })
})
