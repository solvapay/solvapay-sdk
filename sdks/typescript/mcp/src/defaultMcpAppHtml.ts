import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WIDGET_PATH = join(dirname(fileURLToPath(import.meta.url)), '../mcp-app.html')

export async function defaultMcpAppHtml(): Promise<string> {
  return readFile(WIDGET_PATH, 'utf8')
}
