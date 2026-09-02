import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { joinRel, REPO_ROOT } from '../../shared/paths.js'
import { NATIVE_TARGETS } from '../../../sdks/node-native/scripts/targets.mjs'
import {
  filenameMatchesRule,
  loadSupportMatrix,
  nativePlatformPackageNames,
  SUPPORT_MATRIX_JSON_REL,
  supportMatrixJson,
  supportMatrixJsonIsCurrent,
} from './support-matrix.js'

describe('support-matrix', () => {
  it('loads the committed YAML and keeps the JSON snapshot current', () => {
    const matrix = loadSupportMatrix(REPO_ROOT)
    expect(matrix.python.wheels).toHaveLength(7)
    expect(matrix.ruby.gems).toHaveLength(6)
    expect(matrix.ruby.abis).toEqual(['3.1', '3.2', '3.3', '3.4'])
    expect(matrix.python.manylinux).toBe('manylinux2014')
    expect(matrix.python.freeThreaded).toBe('not-supported')
    expect(matrix.nodeNative.targets).toHaveLength(8)
    expect(supportMatrixJsonIsCurrent(REPO_ROOT)).toBe(true)
    expect(readFileSync(joinRel(REPO_ROOT, SUPPORT_MATRIX_JSON_REL), 'utf8')).toBe(
      supportMatrixJson(matrix),
    )
  })

  it('matches filename rules used by the wheel and gem gates', () => {
    const matrix = loadSupportMatrix(REPO_ROOT)
    const manylinux = matrix.python.wheels.find(w => w.id === 'manylinux-x86_64')
    expect(manylinux).toBeDefined()
    expect(
      filenameMatchesRule('solvapay-0.1.0-cp39-abi3-manylinux2014_x86_64.whl', manylinux!),
    ).toBe(true)
    expect(
      filenameMatchesRule('solvapay-0.1.0-cp39-abi3-musllinux_1_1_x86_64.whl', manylinux!),
    ).toBe(false)
  })

  it('lists the same native platform packages as targets.mjs', () => {
    const matrix = loadSupportMatrix(REPO_ROOT)
    expect(nativePlatformPackageNames(matrix)).toEqual(NATIVE_TARGETS.map(t => t.packageName))
    expect(matrix.nodeNative.targets.map(t => t.dir)).toEqual(NATIVE_TARGETS.map(t => t.dir))
    expect(matrix.nodeNative.targets.map(t => t.rustTriple)).toEqual(
      NATIVE_TARGETS.map(t => t.rustTriple),
    )
  })
})
