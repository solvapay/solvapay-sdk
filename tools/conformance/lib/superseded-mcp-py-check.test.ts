import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import {
  formatMcpPySupersededReport,
  runMcpSupersededPyCheck,
} from './superseded-mcp-py-check.js'

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'superseded-mcp-py-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const PKG = 'sdks/python-mcp/python/solvapay_mcp'

describe('mcp-superseded-py-check fixtures', () => {
  it('fails when host-local narrator helpers still exist', () => {
    const root = makeRepo({
      [`${PKG}/server/narrate.py`]:
        'def _plans_list_lines(plans):\n    return ["Plans available:"]\n',
      [`${PKG}/server/narrate_local.py`]: 'def narrate():\n    return "**Welcome to X**"\n',
    })
    const issues = runMcpSupersededPyCheck(root)
    expect(issues.some(i => i.token === '_plans_list_lines')).toBe(true)
    expect(issues.some(i => i.token === 'narrate_local.py')).toBe(true)
    expect(issues.some(i => i.token === 'local narrator markdown')).toBe(true)
  })

  it('fails when engine-owned Python modules still exist', () => {
    const root = makeRepo({
      [`${PKG}/server/dispatch_builtin.py`]: 'def dispatch_solvapay_builtin():\n    return {}\n',
      [`${PKG}/server/bootstrap.py`]: 'def create_build_bootstrap_payload():\n    return None\n',
      [`${PKG}/server/descriptors.py`]: 'def build_solvapay_descriptors():\n    return {}\n',
    })
    const issues = runMcpSupersededPyCheck(root)
    expect(issues.some(i => i.token === 'dispatch_builtin.py')).toBe(true)
    expect(issues.some(i => i.token === 'bootstrap.py')).toBe(true)
    expect(issues.some(i => i.token === 'descriptors.py')).toBe(true)
  })

  it('fails on a local OAuth route table', () => {
    const root = makeRepo({
      [`${PKG}/asgi/mcp_oauth_request.py`]:
        'return await _proxy_customer_auth(params, "/v1/customer/auth/register?product_ref=x", False, http)\n',
    })
    const issues = runMcpSupersededPyCheck(root)
    expect(issues.some(i => i.token === 'local OAuth route table')).toBe(true)
  })

  it('fails on reimplemented OAuth path helpers', () => {
    const root = makeRepo({
      [`${PKG}/oauth/discovery.py`]:
        'def without_trailing_slash(value: str) -> str:\n    return value[:-1] if value.endswith("/") else value\n',
    })
    const issues = runMcpSupersededPyCheck(root)
    expect(issues.some(i => i.token === 'host OAuth path helper')).toBe(true)
  })

  it('passes a native-only narrate wrapper', () => {
    const root = makeRepo({
      [`${PKG}/server/narrate.py`]:
        'from solvapay_mcp.core import call\n\ndef narrate_upgrade(data):\n    return call("mcpNarrate", {"tool": "upgrade", "payload": dict(data)})\n',
      [`${PKG}/core.py`]:
        'def call(op, args=None):\n    raise RuntimeError("SolvaPay native MCP API is not installed")\n',
    })
    expect(runMcpSupersededPyCheck(root)).toEqual([])
    expect(formatMcpPySupersededReport([])).toBe('mcp-superseded-py:check: OK')
  })

  it('passes the live Python MCP tree', () => {
    expect(runMcpSupersededPyCheck(REPO_ROOT)).toEqual([])
  })
})
