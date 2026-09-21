import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../shared/paths.js'
import {
  classifyNormalizedTexts,
  formatAuditReport,
  normalizeTrackedSource,
  parseArgs,
  parseNameStatus,
  probePatch,
  rewriteDevPath,
  type AuditFinding,
} from './check-dev-sync.js'

describe('rewriteDevPath', () => {
  it('maps the three package groups and top-level examples', () => {
    expect(rewriteDevPath('packages/react/src/primitives/LegalFooter.tsx')).toBe(
      'sdks/typescript/react/src/primitives/LegalFooter.tsx',
    )
    expect(rewriteDevPath('packages/mcp-core/src/index.ts')).toBe(
      'sdks/typescript/mcp-core/src/index.ts',
    )
    expect(rewriteDevPath('packages/cli/src/index.ts')).toBe('tools/cli/src/index.ts')
    expect(rewriteDevPath('packages/create-solvapay/src/index.ts')).toBe(
      'tools/create-solvapay/src/index.ts',
    )
    expect(rewriteDevPath('packages/init/src/index.ts')).toBe('tools/init/src/index.ts')
    expect(rewriteDevPath('packages/demo-services/src/index.ts')).toBe(
      'internal/demo-services/src/index.ts',
    )
    expect(rewriteDevPath('packages/test-utils/src/index.ts')).toBe(
      'internal/test-utils/src/index.ts',
    )
    expect(rewriteDevPath('packages/tsconfig/base.json')).toBe('internal/tsconfig/base.json')
    expect(rewriteDevPath('examples/chat-checkout-demo/package.json')).toBe(
      'examples/typescript/chat-checkout-demo/package.json',
    )
  })

  it('leaves unmapped and already-rewritten paths alone', () => {
    expect(rewriteDevPath('packages/unknown/src/index.ts')).toBeNull()
    expect(rewriteDevPath('README.md')).toBeNull()
    expect(rewriteDevPath('examples/typescript/chat-checkout-demo/package.json')).toBeNull()
    expect(rewriteDevPath('sdks/typescript/react/src/index.ts')).toBeNull()
  })
})

describe('parseNameStatus', () => {
  it('reads modifications and rename pairs from NUL output', () => {
    const raw = [
      'M',
      'packages/react/src/a.ts',
      'R095',
      'packages/react/old.ts',
      'packages/react/new.ts',
      '',
    ].join('\0')
    expect(parseNameStatus(raw)).toEqual([
      { status: 'M', path: 'packages/react/src/a.ts' },
      { status: 'R095', path: 'packages/react/new.ts', oldPath: 'packages/react/old.ts' },
    ])
  })
})

describe('probePatch', () => {
  const patch = [
    'diff --git a/target.ts b/target.ts',
    '--- a/target.ts',
    '+++ b/target.ts',
    '@@ -1,3 +1,4 @@',
    ' line1',
    '+inserted',
    ' line2',
    ' line3',
    '',
  ].join('\n')

  it('classifies present, missing, and diverged hunks', () => {
    expect(probePatch(patch, 'target.ts', 'line1\nline2\nline3\n')).toBe('missing')
    expect(probePatch(patch, 'target.ts', 'line1\ninserted\nline2\nline3\n')).toBe('present')
    expect(probePatch(patch, 'target.ts', 'line1\nchanged\nline3\n')).toBe('review')
  })
})

describe('classifyNormalizedTexts', () => {
  it('reports a whole-file drop when the current tree still matches the pre-image', () => {
    expect(
      classifyNormalizedTexts({
        oldText: 'one\n',
        newText: 'two\n',
        currentText: 'one\n',
        rewrittenPath: 'file.ts',
      }),
    ).toEqual([{ kind: 'missing', hunk: '(file)' }])
  })

  it('reports present when the current tree matches the post-image', () => {
    expect(
      classifyNormalizedTexts({
        oldText: 'one\n',
        newText: 'two\n',
        currentText: 'two\n',
        rewrittenPath: 'file.ts',
      }),
    ).toEqual([{ kind: 'present', hunk: '(file)' }])
  })

  it('reports a missing add when the rewritten path does not exist', () => {
    expect(
      classifyNormalizedTexts({
        oldText: null,
        newText: 'created\n',
        currentText: null,
        rewrittenPath: 'file.ts',
      }),
    ).toEqual([{ kind: 'missing', hunk: '(file)' }])
  })

  it('splits a diverged file into present and missing hunks', () => {
    const gap = Array.from({ length: 8 }, (_, index) => `gap ${index}`).join('\n')
    const oldText = `alpha\n${gap}\nomega\n`
    const newText = `ALPHA\n${gap}\nOMEGA\n`
    const currentText = `ALPHA\n${gap}\nomega\n`
    const result = classifyNormalizedTexts({
      oldText,
      newText,
      currentText,
      rewrittenPath: 'file.ts',
    })
    expect(result.map(entry => entry.kind)).toEqual(['present', 'missing'])
  })

  it('does not call a reverted intermediate commit a drop', () => {
    const result = classifyNormalizedTexts({
      oldText: 'alpha\n',
      newText: 'alpha\nbeta\n',
      currentText: 'alpha\n',
      tipText: 'alpha\ngamma\n',
      rewrittenPath: 'file.ts',
    })
    expect(result.map(entry => entry.kind)).toEqual(['review'])
  })

  it('keeps a drop when the inserted lines are still on the dev tip', () => {
    const result = classifyNormalizedTexts({
      oldText: 'alpha\n',
      newText: 'alpha\nbeta\n',
      currentText: 'alpha\n',
      tipText: 'alpha\nbeta\n',
      rewrittenPath: 'file.ts',
    })
    expect(result).toEqual([{ kind: 'missing', hunk: '(file)' }])
  })

  it('treats an add that dev later deleted as present when both sides lack the file', () => {
    const result = classifyNormalizedTexts({
      oldText: null,
      newText: 'created\n',
      currentText: null,
      tipText: null,
      rewrittenPath: 'file.ts',
    })
    expect(result).toEqual([{ kind: 'present', hunk: '(file)' }])
  })
})

describe('formatAuditReport', () => {
  it('lists drops in full and groups review by path', () => {
    const findings: AuditFinding[] = [
      {
        kind: 'missing',
        commit: '4771b85d0000',
        subject: 'host-mediated external links',
        devPath: 'packages/react/src/primitives/LegalFooter.tsx',
        rewrittenPath: 'sdks/typescript/react/src/primitives/LegalFooter.tsx',
        hunk: '(file)',
      },
      {
        kind: 'review',
        commit: 'aaaaaaaaaaaa',
        subject: 'one',
        devPath: 'packages/react/src/i18n/en.ts',
        rewrittenPath: 'sdks/typescript/react/src/i18n/en.ts',
        hunk: '@@ -1 +1 @@',
      },
      {
        kind: 'review',
        commit: 'bbbbbbbbbbbb',
        subject: 'two',
        devPath: 'packages/react/src/i18n/en.ts',
        rewrittenPath: 'sdks/typescript/react/src/i18n/en.ts',
        hunk: '@@ -4 +4 @@',
      },
      {
        kind: 'present',
        commit: 'cccccccccccc',
        subject: 'kept',
        devPath: 'packages/react/src/index.ts',
        rewrittenPath: 'sdks/typescript/react/src/index.ts',
        hunk: '(file)',
      },
    ]
    const report = formatAuditReport(findings)
    expect(report).toContain('confirmed drops: 1')
    expect(report).toContain('4771b85d0000  sdks/typescript/react/src/primitives/LegalFooter.tsx')
    expect(report).toContain('sdks/typescript/react/src/i18n/en.ts  2 hunks across 2 commits')
    expect(report).not.toContain('sdks/typescript/react/src/index.ts  ')
  })
})

describe('parseArgs', () => {
  it('defaults to the layout remap and origin/dev', () => {
    expect(parseArgs([])).toEqual({ since: 'ee190801', ref: 'origin/dev' })
  })

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/)
  })
})

describe('prettier normalization', () => {
  it('strips semicolons so a reformat does not hide a present change', async () => {
    const filepath = 'sdks/typescript/react/src/dev-sync-probe.ts'
    const formatted = await normalizeTrackedSource(
      'export const value = 1;\nexport const extra = 2;\n',
      filepath,
      REPO_ROOT,
    )
    const oldFormatted = await normalizeTrackedSource(
      'export const value = 1;\n',
      filepath,
      REPO_ROOT,
    )
    expect(formatted).not.toContain(';')
    expect(
      classifyNormalizedTexts({
        oldText: oldFormatted,
        newText: formatted,
        currentText: formatted,
        rewrittenPath: filepath,
      }),
    ).toEqual([{ kind: 'present', hunk: '(file)' }])
  })
})
