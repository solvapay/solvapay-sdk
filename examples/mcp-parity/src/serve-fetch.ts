/** Serves a Web-standards fetch handler on Node's http server. */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'

export function serveFetch(
  port: number,
  handler: (request: Request) => Promise<Response>,
  ready: () => void,
): void {
  createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) for (const v of value) headers.append(key, v)
        else if (value !== undefined) headers.set(key, value)
      }
      const controller = new AbortController()
      res.on('close', () => controller.abort())
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
      const response = await handler(
        new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          headers,
          body: hasBody ? Buffer.concat(chunks) : undefined,
          signal: controller.signal,
        }),
      )
      res.writeHead(response.status, Object.fromEntries(response.headers))
      if (response.body) Readable.fromWeb(response.body as never).pipe(res)
      else res.end()
    } catch (error) {
      console.error(error)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  }).listen(port, '127.0.0.1', ready)
}
