import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_PATHS, REPO_ROOT } from '../../shared/paths.js'
import { dirPath } from '../../shared/repo-paths.js'
import {
  RELEASE_TRAIN_CARGO_TOMLS,
  RELEASE_TRAIN_PYPROJECTS,
  RELEASE_TRAIN_RUBY_VERSIONS,
} from './release-train.js'
import { loadSupportMatrix } from './support-matrix.js'
import {
  coverageReportLines,
  defaultPreviewRunNumber,
  hostCoverage,
  missingPreviewTokens,
  parsePreviewArgs,
  previewLanguageFamilyIds,
  previewRestoreRels,
  pythonAllowMissingForArches,
  previewPlan,
  rubyAllowMissingForArches,
  rubyPlatformsForArches,
  previewStampRels,
  goProductionModulePath,
  requiredPreviewToken,
  selectedPreviewLanguages,
  uncoveredHostFamilies,
} from './language-preview.js'

describe('parsePreviewArgs', () => {
  it('defaults to every language, a derived run number, and no dry-run', () => {
    const flags = parsePreviewArgs([])
    expect(flags.only).toBeUndefined()
    expect(flags.version).toBeUndefined()
    expect(flags.run).toBeUndefined()
    expect(flags.dryRun).toBe(false)
    expect(flags.json).toBe(false)
    expect(flags.bail).toBe(false)
    expect(flags.zig).toBe(false)
    expect(flags.allowMissing).toEqual([])
    expect(flags.arch).toEqual([])
    expect(flags.acceptPartial).toBe(false)
  })

  it('rejects an unknown --only language', () => {
    expect(() => parsePreviewArgs(['--only', 'typescript'])).toThrow(
      /unknown language 'typescript'/,
    )
  })

  it('rejects --only without a value', () => {
    expect(() => parsePreviewArgs(['--only'])).toThrow(/--only requires/)
  })

  it('parses --only, --version, --run, --dry-run, --json, --bail, --zig, --allow-missing, and --accept-partial', () => {
    const flags = parsePreviewArgs([
      '--only',
      'python',
      '--version',
      '0.2.0',
      '--run',
      '9',
      '--dry-run',
      '--json',
      '--bail',
      '--zig',
      '--allow-missing',
      'win_amd64,win_arm64',
      '--accept-partial',
    ])
    expect(flags.only).toBe('python')
    expect(flags.version).toBe('0.2.0')
    expect(flags.run).toBe(9)
    expect(flags.dryRun).toBe(true)
    expect(flags.json).toBe(true)
    expect(flags.bail).toBe(true)
    expect(flags.zig).toBe(true)
    expect(flags.allowMissing).toEqual(['win_amd64', 'win_arm64'])
    expect(flags.acceptPartial).toBe(true)
  })

  it('rejects a non-positive --run', () => {
    expect(() => parsePreviewArgs(['--run', '0'])).toThrow(/positive integer/)
  })

  it('parses --arch and rejects an unknown architecture', () => {
    expect(parsePreviewArgs(['--arch', 'macos']).arch).toEqual(['macos'])
    expect(parsePreviewArgs(['--arch', 'macos,linux']).arch).toEqual(['macos', 'linux'])
    expect(() => parsePreviewArgs(['--arch', 'sparc'])).toThrow(/unknown architecture/)
  })
})

describe('defaultPreviewRunNumber', () => {
  it('uses floor(nowMs / 1000) so local runs stay above CI run numbers', () => {
    expect(defaultPreviewRunNumber(1_700_000_000_123)).toBe(1_700_000_000)
    expect(defaultPreviewRunNumber()).toBeGreaterThan(1_000_000)
  })
})

describe('preview versions', () => {
  it('maps each language to its rehearsal ecosystemVersion', () => {
    const plan = previewPlan({ ...parsePreviewArgs([]), run: 7 }, '0.2.0')
    expect(plan.versions).toEqual({
      rust: '0.2.0-rehearsal.7',
      python: '0.2.0.dev7',
      ruby: '0.2.0.pre.7',
      go: '0.2.0-rehearsal.7',
    })
  })
})

describe('tokens', () => {
  it('requires no token for rust and go and named tokens for python and ruby', () => {
    expect(requiredPreviewToken('rust')).toBeUndefined()
    expect(requiredPreviewToken('python')).toBe('SOLVAPAY_TESTPYPI_TOKEN')
    expect(requiredPreviewToken('ruby')).toBe('GEM_HOST_API_KEY')
    expect(requiredPreviewToken('go')).toBeUndefined()
  })

  it('fails loudly when a selected language is missing its token', () => {
    expect(missingPreviewTokens(['rust', 'python'], {})).toEqual(['SOLVAPAY_TESTPYPI_TOKEN'])
    expect(missingPreviewTokens(['python'], { SOLVAPAY_TESTPYPI_TOKEN: '' })).toEqual([
      'SOLVAPAY_TESTPYPI_TOKEN',
    ])
    expect(
      missingPreviewTokens(['rust', 'python', 'ruby', 'go'], {
        SOLVAPAY_TESTPYPI_TOKEN: 't',
        GEM_HOST_API_KEY: 'g',
      }),
    ).toEqual([])
  })

  it('does not require tokens for languages that were not selected', () => {
    expect(missingPreviewTokens(['rust'], {})).toEqual([])
  })
})

describe('selectedPreviewLanguages', () => {
  it('returns every language unless --only is set', () => {
    expect(selectedPreviewLanguages(parsePreviewArgs([]))).toEqual(['rust', 'python', 'ruby', 'go'])
    expect(selectedPreviewLanguages(parsePreviewArgs(['--only', 'go']))).toEqual(['go'])
  })
})

describe('previewPlan stages', () => {
  it('stops after the artifact gate on --dry-run', () => {
    expect(previewPlan(parsePreviewArgs(['--dry-run', '--run', '1']), '0.1.0').stages).toEqual([
      'build',
      'gate',
    ])
    expect(previewPlan(parsePreviewArgs(['--run', '1']), '0.1.0').stages).toEqual([
      'build',
      'gate',
      'publish',
      'smoke',
    ])
  })
})

describe('pythonAllowMissingForArches', () => {
  it('allows every wheel family except the selected architectures', () => {
    expect(pythonAllowMissingForArches(['macos'])).toEqual([
      'manylinux-x86_64',
      'manylinux-aarch64',
      'musllinux-x86_64',
      'musllinux-aarch64',
      'win_amd64',
      'win_arm64',
    ])
    expect(pythonAllowMissingForArches([])).toEqual([])
  })
})

describe('ruby arch selection', () => {
  it('selects both Darwin dock platforms for --arch macos and allows the linux families', () => {
    expect(rubyPlatformsForArches(['macos'])).toEqual(['x86_64-darwin', 'arm64-darwin'])
    expect(rubyAllowMissingForArches(['macos'])).toEqual(['x86_64-linux', 'aarch64-linux'])
    expect(rubyPlatformsForArches([])).toEqual([
      'x86_64-linux',
      'aarch64-linux',
      'x86_64-darwin',
      'arm64-darwin',
    ])
  })
})

describe('previewStampRels', () => {
  it('lists the lockstep manifests that stamping rewrites', () => {
    expect(previewStampRels('rust')).toEqual([...RELEASE_TRAIN_CARGO_TOMLS])
    expect(previewStampRels('python')).toEqual([...RELEASE_TRAIN_PYPROJECTS])
    expect(previewStampRels('ruby')).toEqual([...RELEASE_TRAIN_RUBY_VERSIONS])
    expect(previewStampRels('go')).toEqual([])
  })
})

describe('previewRestoreRels', () => {
  it('restores lockfiles that version stamps rewrite as a side effect', () => {
    expect(previewRestoreRels('python')).toEqual([
      ...RELEASE_TRAIN_PYPROJECTS,
      `${REPO_PATHS.sdks.python}/uv.lock`,
      `${REPO_PATHS.sdks.pythonMcp}/uv.lock`,
    ])
    expect(previewRestoreRels('ruby')).toEqual([
      ...RELEASE_TRAIN_RUBY_VERSIONS,
      `${REPO_PATHS.sdks.ruby}/Gemfile.lock`,
    ])
    expect(previewRestoreRels('rust')).toEqual([...RELEASE_TRAIN_CARGO_TOMLS, 'Cargo.lock'])
    expect(previewRestoreRels('go')).toEqual([])
  })
})

describe('hostCoverage', () => {
  const matrix = loadSupportMatrix(REPO_ROOT)
  const arm64Mac = { platform: 'darwin', arch: 'arm64' }

  it('names every family in support-matrix.yaml', () => {
    const ids = hostCoverage(matrix, arm64Mac)
      .map(row => row.id)
      .sort()
    const expected = [
      ...matrix.python.wheels.map(wheel => wheel.id),
      ...matrix.ruby.gems.map(gem => gem.id),
      ...matrix.nodeNative.targets.map(target => target.dir),
    ].sort()
    expect(ids).toEqual(expected)
  })

  it('classifies the arm64 macOS host the local runner actually proved', () => {
    const byId = new Map(hostCoverage(matrix, arm64Mac).map(row => [row.id, row]))
    expect(byId.get('macos-universal2')?.coverage).toBe('native')
    expect(byId.get('arm64-darwin')?.coverage).toBe('docker')
    expect(byId.get('x86_64-darwin')?.coverage).toBe('docker')
    expect(byId.get('darwin-arm64')?.coverage).toBe('native')
    expect(byId.get('manylinux-x86_64')?.coverage).toBe('docker')
    expect(byId.get('manylinux-aarch64')?.coverage).toBe('docker')
    expect(byId.get('musllinux-aarch64')?.coverage).toBe('docker')
    expect(byId.get('x86_64-linux')?.coverage).toBe('docker')
    expect(byId.get('aarch64-linux')?.coverage).toBe('docker')
    expect(byId.get('musllinux-x86_64')?.coverage).toBe('zig')
    expect(byId.get('win_amd64')?.coverage).toBe('unavailable')
    expect(byId.get('win_arm64')?.coverage).toBe('unavailable')
    expect(byId.get('win32-x64-msvc')?.coverage).toBe('unavailable')
    expect(byId.get('win32-arm64-msvc')?.coverage).toBe('unavailable')
  })

  it('classifies Ruby Darwin as docker on a Linux host so CI and local preview share dock-build', () => {
    const byId = new Map(
      hostCoverage(matrix, { platform: 'linux', arch: 'x64' }).map(row => [row.id, row]),
    )
    expect(byId.get('x86_64-darwin')?.coverage).toBe('docker')
    expect(byId.get('arm64-darwin')?.coverage).toBe('docker')
    expect(byId.get('macos-universal2')?.coverage).toBe('unavailable')
  })
})

describe('coverage report', () => {
  const matrix = loadSupportMatrix(REPO_ROOT)
  const coverage = hostCoverage(matrix, { platform: 'darwin', arch: 'arm64' })

  it('names uncovered preview families with a reason and CI job', () => {
    const relevant = previewLanguageFamilyIds(matrix, ['python', 'ruby'])
    const uncovered = uncoveredHostFamilies(coverage, relevant, new Set())
    const ids = uncovered.map(row => row.id)
    expect(ids).toEqual(expect.arrayContaining(['win_amd64', 'musllinux-x86_64', 'x86_64-darwin']))
    const lines = coverageReportLines(coverage, relevant, new Set())
    expect(lines[0]).toMatch(/^preview coverage: built 0\/\d+$/)
    expect(
      lines.some(line => /win_amd64: unavailable — .+ \(CI: publish-python\.yml\)$/.test(line)),
    ).toBe(true)
  })
})

describe('goProductionModulePath', () => {
  it('is the nested monorepo module path', () => {
    expect(goProductionModulePath()).toBe('github.com/solvapay/solvapay-sdk/sdks/go')
  })
})

describe('CI check-wheels flag', () => {
  it('never passes --allow-missing in a workflow', () => {
    const workflowsDir = dirPath('workflows')
    const hits: string[] = []
    for (const name of readdirSync(workflowsDir)) {
      if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue
      const rel = path.join(workflowsDir, name)
      const text = readFileSync(rel, 'utf8')
      for (const [index, line] of text.split('\n').entries()) {
        if (line.includes('--allow-missing')) {
          hits.push(`${name}:${index + 1}: ${line.trim()}`)
        }
      }
    }
    expect(hits).toEqual([])
  })
})
