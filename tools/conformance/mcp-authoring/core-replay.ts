/**
 * Replay language-neutral MCP core fixtures against TypeScript mcp-core
 * and the native client (async ops).
 */

import { expect } from 'vitest'
import {
  callMcpSyncOp,
  getOAuthAuthorizationServerResponse,
  getOAuthProtectedResourceResponse,
  hideToolsByAudience,
  logDcrFailureDiagnostic,
  mcpAuthGate,
  mcpConfigLogMessage,
  mcpDescriptors,
  mergeCsp,
  toOAuthErrorBody,
} from '@solvapay/mcp-core'
import { NativeClient } from '../../../sdks/node-native/index.js'
import type { Fixture } from '../lib/fixture-schema.js'
import { fixtureHttpStubs, isUnreachableExpect, withFixtureHttp } from './http-stub.js'

const CLIENT_OPS = new Set(['mcpBootstrap', 'mcpCallBuiltinTool', 'mcpOauthRequest', 'mcpDispatch'])

function mcpDcrDiagnostics(args: Record<string, unknown>): unknown {
  const lines: string[] = []
  const original = console.warn
  console.warn = (message?: unknown) => {
    lines.push(String(message ?? ''))
  }
  try {
    logDcrFailureDiagnostic({
      productRef: String(args.productRef),
      apiBaseUrl: String(args.apiBaseUrl),
      status: Number(args.status),
      bodyText: String(args.bodyText ?? ''),
    })
  } finally {
    console.warn = original
  }
  return { message: lines[0] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function stripToken(value: unknown): unknown {
  if (!isRecord(value)) return value
  const { token: _token, ...rest } = value
  return rest
}

function assertOauth(rel: string, got: unknown, expectResult: unknown): void {
  expect(isRecord(got) && isRecord(expectResult)).toBe(true)
  if (!isRecord(got) || !isRecord(expectResult)) return
  expect(got.status).toEqual(expectResult.status)
  expect(got.body).toEqual(expectResult.body)
  if (rel.includes('authorize')) {
    const headers = isRecord(got.headers) ? got.headers : {}
    const loc = String(headers.location ?? '')
    expect(loc.endsWith('/v1/customer/auth/authorize?client_id=abc')).toBe(true)
    return
  }
  if (isRecord(expectResult.headers)) {
    const headers = isRecord(got.headers) ? got.headers : {}
    for (const [key, value] of Object.entries(expectResult.headers)) {
      expect(headers[key]).toEqual(value)
    }
  }
}

function assertCoreResult(rel: string, fn: string, got: unknown, expectResult: unknown): void {
  if (fn === 'mcpOauthRequest') {
    assertOauth(rel, got, expectResult)
    return
  }
  if ((fn === 'mcpHandleRequest' || fn === 'mcpDispatch') && rel.endsWith('invoke-handler.json')) {
    expect(isRecord(got) && isRecord(expectResult)).toBe(true)
    if (!isRecord(got) || !isRecord(expectResult)) return
    expect(got.kind).toEqual(expectResult.kind)
    expect(got.tool).toEqual(expectResult.tool)
    expect(got.args).toEqual(expectResult.args)
    expect(got.customerRef).toEqual(expectResult.customerRef)
    expect(typeof got.token).toBe('string')
    expect(String(got.token).length).toBeGreaterThan(8)
    expect(stripToken(got)).toMatchObject(stripToken(expectResult) as object)
    return
  }
  if (fn === 'mcpHandleRequest' && rel.includes('tools-list')) {
    expect(isRecord(got)).toBe(true)
    if (!isRecord(got)) return
    expect(got.kind).toBe('rpc')
    const rpc = isRecord(got.rpc) ? got.rpc : {}
    const result = isRecord(rpc.result) ? rpc.result : {}
    expect(Array.isArray(result.tools) && result.tools.length >= 8).toBe(true)
    if (Array.isArray(result.tools)) {
      for (const tool of result.tools) {
        if (!isRecord(tool)) continue
        expect(
          tool.title === undefined || typeof tool.title === 'string',
          `${rel} tool ${String(tool.name)} title must be a string or omitted`,
        ).toBe(true)
      }
    }
    if (rel.endsWith('tools-list-modern.json')) {
      expect(result.resultType).toBe('complete')
      expect(result.ttlMs).toBe(60_000)
      expect(result.cacheScope).toBe('public')
    }
    if (rel.endsWith('tools-list-payable.json') && Array.isArray(result.tools)) {
      const echo = result.tools.find(tool => isRecord(tool) && tool.name === 'echo_paid')
      expect(echo, 'payable echo_paid missing from tools/list').toBeTruthy()
      if (isRecord(echo)) {
        expect(echo.title).toBe('Echo paid')
        expect(echo.description).toBe('Echo arguments after a paid gate')
        expect(echo.inputSchema).toEqual({
          type: 'object',
          properties: { n: { type: 'number' } },
        })
      }
    }
    return
  }
  expect(got).toEqual(expectResult)
}

function unwrapClientEnvelope(envelopeJson: string): unknown {
  const envelope: unknown = JSON.parse(envelopeJson)
  if (!isRecord(envelope) || envelope.ok !== true) {
    throw new Error(`native MCP client op failed: ${envelopeJson}`)
  }
  return envelope.value
}

async function callClientOp(
  fn: string,
  args: Record<string, unknown>,
  apiBaseUrl: string,
): Promise<unknown> {
  const client = new NativeClient('sk_test_fixture', apiBaseUrl)
  switch (fn) {
    case 'mcpBootstrap':
      return unwrapClientEnvelope(await client.mcpBootstrap(JSON.stringify(args)))
    case 'mcpCallBuiltinTool':
      return unwrapClientEnvelope(await client.mcpCallBuiltinTool(JSON.stringify(args)))
    case 'mcpOauthRequest':
      return unwrapClientEnvelope(await client.mcpOauthRequest(JSON.stringify(args)))
    case 'mcpDispatch':
      return unwrapClientEnvelope(await client.mcpDispatch(JSON.stringify(args)))
    default:
      throw new Error(`not a client MCP op: ${fn}`)
  }
}

async function replayClientOp(
  rel: string,
  fn: string,
  args: Record<string, unknown>,
  expectResult: unknown,
  raw: unknown,
): Promise<void> {
  const run = async (apiBaseUrl: string) => {
    const got = await callClientOp(fn, args, apiBaseUrl)
    assertCoreResult(rel, fn, got, expectResult)
  }
  if (isUnreachableExpect(expectResult)) {
    await run('http://127.0.0.1:1')
    return
  }
  await withFixtureHttp(fixtureHttpStubs(raw, fn), run)
}

/** Replay a non-registerPayable MCP fixture through TypeScript mcp-core / native client. */
export async function replayMcpCoreFixture(
  fixture: Fixture,
  raw: unknown = fixture,
  rel = `${fixture.suite}/${fixture.case}.json`,
): Promise<void> {
  const { fn, args } = fixture.input
  const expectResult = fixture.expect.result
  if (CLIENT_OPS.has(fn)) {
    await replayClientOp(rel, fn, args, expectResult, raw)
    return
  }
  let got: unknown
  switch (fn) {
    case 'mcpDescriptors':
      got = mcpDescriptors(args as Parameters<typeof mcpDescriptors>[0])
      break
    case 'mcpMergeCsp':
      got = mergeCsp(
        args.overrides as Parameters<typeof mergeCsp>[0],
        args.apiBaseUrl as string | undefined,
      )
      break
    case 'mcpOauthDiscovery': {
      const kind = args.kind as string
      const publicBaseUrl = String(args.publicBaseUrl)
      const mcpPath = args.mcpPath as string | undefined
      got =
        kind === 'authorization-server'
          ? getOAuthAuthorizationServerResponse({ publicBaseUrl })
          : getOAuthProtectedResourceResponse(publicBaseUrl, mcpPath)
      break
    }
    case 'mcpNormalizeOauthError':
      got = toOAuthErrorBody(args.body, String(args.text ?? ''), Number(args.status))
      break
    case 'mcpAuthGate':
      got = mcpAuthGate({
        rpcMethod: args.rpcMethod as string | undefined,
        authHeader: args.authHeader as string | null | undefined,
        authMode: (args.authMode as 'tools-call' | 'all') ?? 'tools-call',
        publicBaseUrl: String(args.publicBaseUrl),
        ...(args.mcpPath !== undefined ? { mcpPath: String(args.mcpPath) } : {}),
        jsonRpcId: (args.jsonRpcId as string | number | null | undefined) ?? null,
        ...(args.jwksJson !== undefined ? { jwksJson: args.jwksJson } : {}),
        ...(args.hs256Secret !== undefined ? { hs256Secret: String(args.hs256Secret) } : {}),
        ...(args.expectedIssuer !== undefined
          ? { expectedIssuer: String(args.expectedIssuer) }
          : {}),
        ...(args.expectedAudience !== undefined
          ? { expectedAudience: String(args.expectedAudience) }
          : {}),
        ...(args.nowUnixSecs !== undefined ? { nowUnixSecs: Number(args.nowUnixSecs) } : {}),
      })
      break
    case 'mcpVerifyBearer':
      got = callMcpSyncOp(fn, args)
      break
    case 'mcpDcrDiagnostics':
      got = mcpDcrDiagnostics(args)
      break
    case 'mcpConfigLog':
      got = {
        message: mcpConfigLogMessage({
          apiBaseUrl: String(args.apiBaseUrl),
          productRef: String(args.productRef),
          publicBaseUrl: String(args.publicBaseUrl),
        }),
      }
      break
    case 'mcpHideToolsByAudience':
      got = hideToolsByAudience(
        args.tools as Array<{ _meta?: { audience?: string } }>,
        args.audiences as string[],
        args.userAgent as string | undefined,
      )
      break
    case 'mcpNarrate':
    case 'mcpDefaultGate':
    case 'mcpNativeCors':
    case 'mcpHandleRequest':
    case 'mcpResume':
    case 'mcpOauthPath':
    case 'mcpOauthErrorInspect':
    case 'mcpOverviewResource':
    case 'mcpWidgetResource':
      got = callMcpSyncOp(fn, args)
      break
    default:
      throw new Error(`no TypeScript core binding for ${fn}`)
  }
  assertCoreResult(rel, fn, got, expectResult)
}
