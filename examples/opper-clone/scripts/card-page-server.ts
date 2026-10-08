// A one-page local server for saving a card with Stripe.js (agent payments
// PoC, S3). It stands in for the SolvaPay console's card page until that
// exists: the page confirms the SetupIntent on the merchant's connected
// account, including the 3DS challenge, and reports back here.
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface CardPageConfig {
  publishableKey: string
  stripeAccountId: string
  clientSecret: string
  /** Shown on the page so the person knows whose card form this is. */
  merchant: string
}

export interface CardPageResult {
  setupIntentId: string
  status: string
}

export interface CardPageServer {
  url: string
  /** Resolves when the page reports a confirmed SetupIntent. */
  done: Promise<CardPageResult>
  close(): Promise<void>
}

const PAGE = new URL('./card-page.html', import.meta.url)
// The page's placeholder: the CARD_PAGE_CONFIG comment followed by `null`,
// with or without the space a formatter puts between them.
const CONFIG_MARKER = /\/\*CARD_PAGE_CONFIG\*\/\s*null/
const MAX_BODY_BYTES = 4096

/** Serves the page on 127.0.0.1 only; port 0 picks a free one. */
export async function startCardPageServer(
  config: CardPageConfig,
  port: number,
): Promise<CardPageServer> {
  const template = await readFile(PAGE, 'utf8')
  if (!CONFIG_MARKER.test(template)) throw new Error('card-page.html has lost its config marker')
  // JSON in a script tag: escape `<` so no value can close the tag. A function
  // replacement, so `$` in a value is not read as a pattern.
  const json = JSON.stringify(config).replace(/</g, '\\u003c')
  const page = template.replace(CONFIG_MARKER, () => json)

  let resolveDone: (result: CardPageResult) => void
  const done = new Promise<CardPageResult>(resolve => {
    resolveDone = resolve
  })

  const server: Server = createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url?.startsWith('/?'))) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(page)
      return
    }
    if (req.method === 'POST' && req.url === '/done') {
      let body = ''
      req.on('data', chunk => {
        body += chunk
        if (body.length > MAX_BODY_BYTES) req.destroy()
      })
      req.on('end', () => {
        const result = parseResult(body)
        if (!result) {
          res.writeHead(400).end()
          return
        }
        res.writeHead(204).end()
        resolveDone(result)
      })
      return
    }
    res.writeHead(404).end()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const { port: bound } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${bound}/`,
    done,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

function parseResult(body: string): CardPageResult | null {
  try {
    const value = JSON.parse(body) as Partial<CardPageResult>
    if (typeof value.setupIntentId !== 'string' || !value.setupIntentId.startsWith('seti_')) {
      return null
    }
    if (typeof value.status !== 'string') return null
    return { setupIntentId: value.setupIntentId, status: value.status }
  } catch {
    return null
  }
}
