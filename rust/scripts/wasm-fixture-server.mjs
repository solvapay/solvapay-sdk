#!/usr/bin/env node
/**
 * Minimal mock server for solvapay-transport wasm Fetch round-trips.
 *
 * - Loads contract/fixtures/client/** JSON files that contain a `wire` block
 * - GET /__fixtures → corpus JSON: [{ path, fixture }, ...]
 * - Per-fixture isolation (many cases share identical wire.request but differ
 *   in wire.response): round-trips hit `/__case/<index><wire.path>` so each
 *   fixture mounts alone — mirrors native wiremock's one-server-per-fixture.
 * - Match method/path/query/headers/body against that entry → recorded response
 *   (else HTTP 599)
 *
 * Usage: node wasm-fixture-server.mjs <fixturesRoot> <port>
 * Prints `listening <port>` on stdout when ready.
 */

import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const fixturesRoot = path.resolve(
  process.argv[2] ?? path.join(__dirname, '../../contract/fixtures/client'),
)
const port = Number.parseInt(process.argv[3] ?? '0', 10)

/**
 * @typedef {{ method: string, path: string, query?: Record<string, string>, headers?: Record<string, string>, body?: unknown }} WireRequest
 * @typedef {{ status: number, body: unknown }} WireResponse
 * @typedef {{ path: string, fixture: object, wire: { request: WireRequest, response: WireResponse } }} CorpusEntry
 */

/** @type {CorpusEntry[]} */
const corpus = await loadCorpus(fixturesRoot)

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res)
  } catch (err) {
    console.error(err)
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(String(err?.stack ?? err))
  }
})

server.listen(port, '127.0.0.1', () => {
  const addr = server.address()
  const bound = typeof addr === 'object' && addr ? addr.port : port
  console.log(`listening ${bound}`)
})

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handle(req, res) {
  const method = (req.method ?? 'GET').toUpperCase()
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (method === 'GET' && url.pathname === '/__fixtures') {
    const payload = corpus.map(({ path: p, fixture }) => ({ path: p, fixture }))
    const body = JSON.stringify(payload)
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
    return
  }

  const caseMatch = url.pathname.match(/^\/__case\/(\d+)(\/.*)$/)
  if (!caseMatch) {
    res.writeHead(599, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('expected /__case/<index>/<wire-path>')
    return
  }

  const index = Number.parseInt(caseMatch[1], 10)
  const wirePath = caseMatch[2]
  const entry = corpus[index]
  if (!entry) {
    res.writeHead(599, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`unknown fixture index ${index}`)
    return
  }

  const rawBody = await readBody(req)
  if (!requestMatches(entry.wire.request, method, wirePath, url.searchParams, req.headers, rawBody)) {
    res.writeHead(599, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`request did not match fixture ${entry.path}`)
    return
  }

  const { status, body } = entry.wire.response
  const bodyBuf = responseBodyBytes(body)
  res.writeHead(status, {
    'content-type':
      typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'content-length': bodyBuf.length,
  })
  res.end(bodyBuf)
}

/**
 * @param {WireRequest} expected
 * @param {string} method
 * @param {string} wirePath
 * @param {URLSearchParams} searchParams
 * @param {http.IncomingHttpHeaders} headers
 * @param {Buffer} rawBody
 */
function requestMatches(expected, method, wirePath, searchParams, headers, rawBody) {
  if (expected.method.toUpperCase() !== method) return false
  if (expected.path !== wirePath) return false
  if (!queryMatches(expected.query, searchParams)) return false
  if (!headersMatch(expected.headers, headers)) return false
  if (!bodyMatches(expected.body, rawBody)) return false
  return true
}

/**
 * @param {Record<string, string> | undefined} expected
 * @param {URLSearchParams} actual
 */
function queryMatches(expected, actual) {
  if (!expected) return true
  for (const [key, value] of Object.entries(expected)) {
    if (actual.get(key) !== value) return false
  }
  return true
}

/**
 * @param {Record<string, string> | undefined} expected
 * @param {http.IncomingHttpHeaders} actual
 */
function headersMatch(expected, actual) {
  if (!expected) return true
  for (const [name, value] of Object.entries(expected)) {
    const got = actual[name.toLowerCase()]
    const normalized = Array.isArray(got) ? got.join(', ') : got
    if (normalized !== value) return false
  }
  return true
}

/**
 * @param {unknown} expected
 * @param {Buffer} rawBody
 */
function bodyMatches(expected, rawBody) {
  if (expected === undefined) return true
  let actual
  try {
    actual = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return false
  }
  return deepEqual(actual, expected)
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object') {
    const ak = Object.keys(/** @type {object} */ (a)).sort()
    const bk = Object.keys(/** @type {object} */ (b)).sort()
    if (ak.length !== bk.length) return false
    return ak.every((k, i) => k === bk[i] && deepEqual(a[k], b[k]))
  }
  return false
}

/**
 * @param {unknown} body
 * @returns {Buffer}
 */
function responseBodyBytes(body) {
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8')
  }
  return Buffer.from(JSON.stringify(body), 'utf8')
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * @param {string} root
 * @returns {Promise<CorpusEntry[]>}
 */
async function loadCorpus(root) {
  /** @type {CorpusEntry[]} */
  const out = []
  for await (const filePath of walkJson(root)) {
    const text = await fs.readFile(filePath, 'utf8')
    let fixture
    try {
      fixture = JSON.parse(text)
    } catch (err) {
      throw new Error(`parse JSON ${filePath}: ${err}`)
    }
    if (!fixture?.wire?.request || !fixture?.wire?.response) continue
    const rel = path.relative(root, filePath).split(path.sep).join('/')
    out.push({
      path: rel,
      fixture,
      wire: fixture.wire,
    })
  }
  out.sort((a, b) => a.path.localeCompare(b.path))
  if (out.length === 0) {
    throw new Error(`no wire fixtures under ${root}`)
  }
  return out
}

/**
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walkJson(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkJson(full)
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      yield full
    }
  }
}
