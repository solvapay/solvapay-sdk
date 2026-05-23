import { describe, expect, it } from 'vitest'
import {
  hasMcpSpecificFlags,
  inferMcpMode,
  parseArgs,
  parseMcpArgs,
  sanitizeProjectName,
  validateToolName,
} from './args'

describe('parseArgs', () => {
  it('captures the positional project name', () => {
    const result = parseArgs(['my-app'])
    expect(result.projectName).toBe('my-app')
    expect(result.unknownFlag).toBeUndefined()
  })

  it('parses --type <kind>', () => {
    const result = parseArgs(['my-app', '--type', 'mcp'])
    expect(result.projectName).toBe('my-app')
    expect(result.type).toBe('mcp')
  })

  it('parses --list-types', () => {
    expect(parseArgs(['--list-types']).listTypes).toBe(true)
  })

  it('parses -y and --yes interchangeably', () => {
    expect(parseArgs(['-y']).yes).toBe(true)
    expect(parseArgs(['--yes']).yes).toBe(true)
  })

  it('parses --non-interactive (implies --yes)', () => {
    const result = parseArgs(['--non-interactive'])
    expect(result.nonInteractive).toBe(true)
    expect(result.yes).toBe(true)
  })

  it('parses --product <ref>', () => {
    const result = parseArgs(['--product', 'prd_abc'])
    expect(result.product).toBe('prd_abc')
  })

  it('parses --help and -h', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
  })

  it('ignores `--` pass-through separator', () => {
    const result = parseArgs(['my-app', '--', '--yes'])
    expect(result.projectName).toBe('my-app')
    expect(result.yes).toBe(true)
  })

  it('rejects unknown flags', () => {
    const result = parseArgs(['--bogus'])
    expect(result.unknownFlag).toBe('--bogus')
  })

  it('flags missing value for value-flags', () => {
    const result = parseArgs(['--type'])
    expect(result.unknownFlag).toContain('--type requires a value')
  })

  it('does not capture MCP-specific flags at the top level', () => {
    const result = parseArgs(['my-app', '--type', 'mcp', '--openapi', './openapi.json'])
    expect(result.type).toBe('mcp')
    expect(result.unknownFlag).toBeUndefined()
  })
})

describe('parseMcpArgs', () => {
  it('parses --openapi <value>', () => {
    const result = parseMcpArgs(['my-app', '--type', 'mcp', '--openapi', 'https://api.example.com/openapi.json'])
    expect(result.openapi).toBe('https://api.example.com/openapi.json')
  })

  it('parses --no-openapi', () => {
    expect(parseMcpArgs(['--no-openapi']).noOpenapi).toBe(true)
  })

  it('parses --tool-name <camel>', () => {
    expect(parseMcpArgs(['--tool-name', 'fetchPet']).toolName).toBe('fetchPet')
  })

  it('parses a realistic mix', () => {
    const result = parseMcpArgs([
      'my-app',
      '--type',
      'mcp',
      '--openapi',
      './openapi.json',
      '--tool-name',
      'ignored',
    ])
    expect(result).toMatchObject({
      openapi: './openapi.json',
      toolName: 'ignored',
    })
  })
})

describe('hasMcpSpecificFlags', () => {
  it('detects MCP-specific flags in raw argv', () => {
    expect(hasMcpSpecificFlags(['--no-openapi'])).toBe(true)
    expect(hasMcpSpecificFlags(['--type', 'mcp'])).toBe(false)
  })
})

describe('inferMcpMode', () => {
  it('returns from-openapi when --openapi is set', () => {
    expect(inferMcpMode(parseMcpArgs(['--openapi', './s.json']))).toBe('from-openapi')
  })

  it('returns from-scratch when --no-openapi is set', () => {
    expect(inferMcpMode(parseMcpArgs(['--no-openapi']))).toBe('from-scratch')
  })

  it('returns null when neither is set (CLI must prompt)', () => {
    expect(inferMcpMode(parseMcpArgs([]))).toBeNull()
  })
})

describe('sanitizeProjectName', () => {
  it('accepts a clean kebab-case name', () => {
    expect(sanitizeProjectName('my-mcp')).toEqual({ ok: true, name: 'my-mcp' })
  })

  it('lowercases and replaces spaces', () => {
    expect(sanitizeProjectName('My App')).toEqual({ ok: true, name: 'my-app' })
  })

  it('rejects an empty string', () => {
    const result = sanitizeProjectName('')
    expect(result.ok).toBe(false)
  })

  it('rejects names that resolve to only punctuation', () => {
    const result = sanitizeProjectName('___')
    expect(result.ok).toBe(false)
  })
})

describe('validateToolName', () => {
  it('accepts a clean camelCase name', () => {
    expect(validateToolName('fetchPet')).toEqual({ ok: true, name: 'fetchPet' })
  })

  it('accepts a single lowercase word', () => {
    expect(validateToolName('hello')).toEqual({ ok: true, name: 'hello' })
  })

  it('rejects PascalCase', () => {
    expect(validateToolName('FetchPet').ok).toBe(false)
  })

  it('rejects kebab-case', () => {
    expect(validateToolName('fetch-pet').ok).toBe(false)
  })

  it('rejects empty', () => {
    expect(validateToolName('').ok).toBe(false)
  })
})
