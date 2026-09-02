import { describe, expect, it } from 'vitest'
import {
  INTERNAL_PACKAGE_IDS,
  TOOL_PACKAGE_IDS,
  TS_PACKAGE_IDS,
  internalPackageDir,
  joinRoot,
  toolPackageDir,
  tsPackageDir,
} from './paths.js'

describe('TypeScript package accessors', () => {
  it('enumerates published SDK package ids', () => {
    expect([...TS_PACKAGE_IDS]).toEqual([
      'auth',
      'core',
      'mcp',
      'mcp-core',
      'next',
      'react',
      'react-supabase',
      'server',
    ])
  })

  it('enumerates tool and internal package ids', () => {
    expect([...TOOL_PACKAGE_IDS]).toEqual(['cli', 'create-solvapay', 'init'])
    expect([...INTERNAL_PACKAGE_IDS]).toEqual([
      'demo-services',
      'release-train',
      'test-utils',
      'tsconfig',
    ])
  })

  it('resolves each bucket from the layout manifest', () => {
    expect(tsPackageDir('server')).toBe(joinRoot('sdks/typescript/server'))
    expect(toolPackageDir('cli')).toBe(joinRoot('tools/cli'))
    expect(internalPackageDir('tsconfig')).toBe(joinRoot('internal/tsconfig'))
  })
})
