import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  allowsRequiredMcp,
  fastmcpUses,
  findMcpImports,
  inspectPythonMcpProject,
  pythonMcpBlockers,
} from './python-mcp'

const uvLock = (packages: Record<string, string>) =>
  `version = 1\n${Object.entries(packages)
    .map(([name, version]) => `\n[[package]]\nname = "${name}"\nversion = "${version}"\n`)
    .join('')}`

describe('allowsRequiredMcp', () => {
  it.each([
    ['', true],
    ['>=1.30.0', true],
    ['>=2.3,<3', true],
    ['<2', false],
    ['>=1.30.0,<2', false],
    ['<2.3', false],
    ['<=2.3', true],
    ['<=2.2.9', false],
    ['==1.30.0', false],
    ['==2.3.1', true],
    ['==1.*', false],
    ['==2.*', true],
    ['~=1.30', false],
    ['~=2.1', true],
    ['~=2.1.0', false],
    ['^1.30', false],
    ['^2.3', true],
    ['>=1.30; python_version >= "3.10"', true],
  ])('%s → %s', (spec, allowed) => {
    expect(allowsRequiredMcp(spec)).toBe(allowed)
  })
})

describe('inspectPythonMcpProject', () => {
  let cwd: string
  const write = async (name: string, content: string) => {
    await mkdir(path.dirname(path.join(cwd, name)), { recursive: true })
    await writeFile(path.join(cwd, name), content)
  }

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), 'python-mcp-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('blocks a legacy mcp 1.x FastMCP server, as tutorials leave it', async () => {
    await write('pyproject.toml', '[project]\ndependencies = ["mcp[cli]>=1.30.0"]\n')
    await write('uv.lock', uvLock({ mcp: '1.30.0', httpx: '0.28.1' }))
    await write('server.py', 'from mcp.server.fastmcp import FastMCP\n\nmcp = FastMCP("x")\n')

    const project = await inspectPythonMcpProject(cwd)

    expect(project.mcp).toEqual({ version: '1.30.0', source: 'uv.lock' })
    expect(pythonMcpBlockers(project)).toEqual([
      'uv.lock locks mcp 1.30.0',
      'server.py:1 imports mcp.server.fastmcp, which mcp 2.0 removed (FastMCP is now MCPServer)',
    ])
  })

  it('blocks a declared cap below 2 and fastapi-mcp', async () => {
    await write(
      'pyproject.toml',
      '[project]\ndependencies = ["fastapi>=0.115", "fastapi-mcp>=0.4.0", "mcp>=1.30,<2"]\n',
    )
    await write('uv.lock', uvLock({ 'fastapi-mcp': '0.4.0', mcp: '1.30.0' }))
    await write('app/main.py', 'from fastapi import FastAPI\nfrom fastapi_mcp import FastApiMCP\n')

    const blockers = pythonMcpBlockers(await inspectPythonMcpProject(cwd))

    expect(blockers).toEqual([
      'uv.lock locks mcp 1.30.0',
      'pyproject.toml requires mcp>=1.30,<2, which rules out mcp 2.3',
      'uv.lock and pyproject.toml list fastapi-mcp, which runs only on mcp 1.x',
      'app/main.py:2 imports fastapi_mcp, which runs only on mcp 1.x',
    ])
  })

  it('reads Poetry carets and exact requirements.txt pins', async () => {
    await write(
      'pyproject.toml',
      '[tool.poetry.dependencies]\nmcp = { version = "^1.30", extras = ["cli"] }\n',
    )
    await write('requirements.txt', 'mcp==1.29.0  # pinned\n')

    const project = await inspectPythonMcpProject(cwd)

    expect(project.mcp).toEqual({ version: '1.29.0', source: 'requirements.txt' })
    expect(project.mcpCaps).toEqual([
      { requirement: 'mcp = "^1.30"', source: 'pyproject.toml' },
      { requirement: 'mcp==1.29.0', source: 'requirements.txt' },
    ])
  })

  it('passes a project on mcp 2.x and only warns on fastmcp', async () => {
    await write(
      'pyproject.toml',
      '[project]\ndependencies = ["fastmcp>=4.2", "solvapay[mcp]==0.1.0"]\n',
    )
    await write('uv.lock', uvLock({ fastmcp: '4.2.0', mcp: '2.3.0', solvapay: '0.1.0' }))
    await write('server.py', 'import os\nfrom fastmcp import FastMCP\n')

    const project = await inspectPythonMcpProject(cwd)

    expect(pythonMcpBlockers(project)).toEqual([])
    expect(project.solvapayMcpExtra).toBe(true)
    expect(fastmcpUses(project)).toEqual(['uv.lock', 'pyproject.toml', 'server.py:2'])
  })

  it('does not mistake other packages for mcp', async () => {
    await write(
      'pyproject.toml',
      '[project]\ndependencies = ["mcp-proxy<1", "fastapi-mcp-extras==0.1"]\n',
    )
    await write('requirements.txt', 'mcpx<2\n')

    const project = await inspectPythonMcpProject(cwd)

    expect(project.mcpCaps).toEqual([])
    expect(project.fastapiMcp).toEqual([])
  })
})

describe('findMcpImports', () => {
  let cwd: string
  const write = async (name: string, content: string) => {
    await mkdir(path.dirname(path.join(cwd, name)), { recursive: true })
    await writeFile(path.join(cwd, name), content)
  }

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), 'python-mcp-imports-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('finds each import form and skips virtualenvs and hidden folders', async () => {
    await write(
      'server.py',
      [
        'import mcp.server.fastmcp',
        'from mcp.server import FastMCP',
        '# from fastmcp import FastMCP',
        'from mcp.server.mcpserver import MCPServer',
        '    from fastmcp.server import FastMCP',
      ].join('\n'),
    )
    await write('.venv/lib/site.py', 'from mcp.server.fastmcp import FastMCP\n')
    await write('venv/x.py', 'from fastapi_mcp import FastApiMCP\n')
    await write('node_modules/y.py', 'import fastmcp\n')

    expect(await findMcpImports(cwd)).toEqual([
      { file: 'server.py', line: 1, module: 'mcp.server.fastmcp' },
      { file: 'server.py', line: 2, module: 'mcp.server.fastmcp' },
      { file: 'server.py', line: 5, module: 'fastmcp' },
    ])
  })
})
