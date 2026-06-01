import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createSolvaPay } from '@solvapay/server'
import { handleApiRequest, type ApiDeps } from './handlers'

/**
 * Node ⇄ Web adapter for the Vite dev plugin. The actual routing
 * lives in `handlers.ts` so the same dispatcher runs unchanged in a
 * Cloudflare Worker (`src/worker.ts`).
 *
 * `vite.config.ts` seeds `process.env.SOLVAPAY_SECRET_KEY` /
 * `SOLVAPAY_API_BASE_URL` / `GEMINI_API_KEY` from the example's
 * `.env`. We construct `deps` lazily (on first request) because
 * `vitePlugin.ts` imports this module at config-load time — before
 * vite has had a chance to seed `process.env`.
 */
let cachedDeps: ApiDeps | undefined

function getDeps(): ApiDeps {
  if (cachedDeps) return cachedDeps
  const apiKey = process.env.SOLVAPAY_SECRET_KEY ?? ''
  if (!apiKey) {
    throw new Error(
      'SOLVAPAY_SECRET_KEY is not set — fill it in `.env` to enable /api/* routes',
    )
  }
  cachedDeps = {
    solvaPay: createSolvaPay({
      apiKey,
      apiBaseUrl: process.env.SOLVAPAY_API_BASE_URL,
    }),
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  }
  return cachedDeps
}

export async function handleSolvaPayRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let webResponse: Response
  try {
    const webRequest = await nodeToWebRequest(req)
    webResponse = await handleApiRequest(webRequest, getDeps())
  } catch (error) {
    console.error('[solvapay-api] adapter error:', error)
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }))
    return
  }

  await pipeWebResponseToNode(webResponse, res)
}

async function nodeToWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `http://${host}`)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else if (typeof value === 'string') {
      headers.set(key, value)
    }
  }

  const init: RequestInit = { method: req.method, headers }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await readNodeBody(req)
  }

  return new Request(url.toString(), init)
}

function readNodeBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Forward a Web `Response` (including streaming bodies — used by
 * `/api/chat`'s NDJSON output) to a Node `ServerResponse`.
 */
async function pipeWebResponseToNode(webResponse: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webResponse.status
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  if (!webResponse.body) {
    res.end()
    return
  }

  // Vite 8 requires Node 20+, which has `Readable.fromWeb` stable —
  // it handles streaming Response bodies (e.g. /api/chat NDJSON)
  // without manual reader-pumps.
  await new Promise<void>((resolve, reject) => {
    const nodeStream = Readable.fromWeb(webResponse.body as Parameters<typeof Readable.fromWeb>[0])
    nodeStream.on('error', reject)
    nodeStream.on('end', resolve)
    nodeStream.pipe(res)
  })
}
