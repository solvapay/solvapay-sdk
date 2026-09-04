import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { namePlaceholders } from './names'
import {
  copyDir,
  deriveServerName,
  mcpLanguageTemplateDir,
  PLACEHOLDERS,
} from '../types/mcp/scaffold'

const LANGUAGES = ['python', 'ruby', 'go', 'rust'] as const
const UNRESOLVED = /__[A-Z][A-Z0-9_]*__/

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full)))
    } else {
      out.push(full)
    }
  }
  return out
}

describe('language MCP templates', () => {
  for (const language of LANGUAGES) {
    it(`renders ${language} without unresolved placeholders`, async () => {
      const target = await mkdtemp(path.join(os.tmpdir(), `create-solvapay-${language}-`))
      try {
        const names = namePlaceholders({ projectName: 'demo-mcp', toolName: 'helloTool' })
        const substitutions = new Map<string, string>([
          [PLACEHOLDERS.WORKER_NAME, 'demo-mcp'],
          [PLACEHOLDERS.RESOURCE_URI_SLUG, 'demo-mcp'],
          [PLACEHOLDERS.SERVER_NAME, deriveServerName('demo-mcp')],
          [PLACEHOLDERS.PRODUCT_REF, 'prd_test'],
          [PLACEHOLDERS.PUBLIC_BASE_URL, 'http://localhost:3030'],
          [PLACEHOLDERS.TOOL_NAME_PASCAL, 'HelloTool'],
          [PLACEHOLDERS.TOOL_NAME, names.toolNameSnake],
          ['__PYTHON_PACKAGE__', names.pythonPackage],
          ['__RUBY_MODULE__', names.rubyModule],
          ['__GO_MODULE__', names.goModule],
          ['__CRATE_NAME__', names.crateName],
          ['__BIN_NAME__', names.binName],
          ['__TOOL_NAME_SNAKE__', names.toolNameSnake],
        ])
        await copyDir(mcpLanguageTemplateDir(language), target, { substitutions })

        const files = await walkFiles(target)
        expect(files.length).toBeGreaterThan(3)
        for (const file of files) {
          if (file.endsWith('.png') || file.endsWith('.wasm')) continue
          const raw = await readFile(file, 'utf8')
          expect(raw, file).not.toMatch(UNRESOLVED)
        }

        const gitignore = await readFile(path.join(target, '.gitignore'), 'utf8')
        expect(gitignore).toContain('.env')
      } finally {
        await rm(target, { recursive: true, force: true })
      }
    })
  }
})
