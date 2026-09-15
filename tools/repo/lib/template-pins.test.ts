import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import { collectTemplatePinDrift, formatTemplatePinDrift } from './template-pins.js'
import { readReleaseTrainVersion } from './release-train.js'

describe('template pins', () => {
  it('keeps scaffolder SDK pins on the unified version', () => {
    const version = readReleaseTrainVersion(REPO_ROOT)
    expect(collectTemplatePinDrift(REPO_ROOT, version)).toEqual([])
    expect(formatTemplatePinDrift([])).toBe('template-pins: OK')
  })
})
