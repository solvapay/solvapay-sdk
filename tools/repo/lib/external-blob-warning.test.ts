import { describe, expect, it } from 'vitest'
import type { VerifyResult } from '../../codegen/external-generated.js'
import { externalGeneratedEntry } from '../../shared/repo-paths.js'
import {
  EXTERNAL_BLOB_DRIFT_BANNER,
  formatExternalBlobWarning,
  stagedExternalBlobWarning,
} from './external-blob-warning.js'

const goWasm = externalGeneratedEntry('goCoreWasm').paths[0] ?? 'go-core-wasm'

const mismatch: VerifyResult = {
  id: 'goCoreWasm',
  status: 'warn',
  message: `${goWasm} hash mismatch`,
}

describe('formatExternalBlobWarning', () => {
  it('returns undefined when hashes match', () => {
    expect(formatExternalBlobWarning([])).toBeUndefined()
  })

  it('prints a do-not-commit banner that names generated:external --rebuild', () => {
    const warning = formatExternalBlobWarning([mismatch])
    expect(warning).toContain(EXTERNAL_BLOB_DRIFT_BANNER)
    expect(warning).toContain('pnpm generated:external --rebuild')
    expect(warning).toContain(mismatch.message)
  })
})

describe('stagedExternalBlobWarning', () => {
  it('is silent when no blob path is staged', () => {
    expect(stagedExternalBlobWarning(['README.md'], [mismatch], [mismatch.message])).toBeUndefined()
  })

  it('warns when a drifted blob path is staged', () => {
    const warning = stagedExternalBlobWarning(
      [goWasm],
      [{ ...mismatch, message: `${goWasm} hash mismatch` }],
      [goWasm],
    )
    expect(warning).toContain(EXTERNAL_BLOB_DRIFT_BANNER)
  })

  it('is silent when a matching blob is staged', () => {
    expect(stagedExternalBlobWarning([goWasm], [], [goWasm])).toBeUndefined()
  })
})
