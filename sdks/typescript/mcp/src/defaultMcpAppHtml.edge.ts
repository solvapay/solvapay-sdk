const EDGE_HTML_ERROR =
  'defaultMcpAppHtml is unavailable on edge runtimes. Pass `readHtml` or `htmlPath` explicitly when creating the MCP server.'

export function defaultMcpAppHtmlPath(): never {
  throw new Error(EDGE_HTML_ERROR)
}

export async function defaultMcpAppHtml(): Promise<never> {
  throw new Error(EDGE_HTML_ERROR)
}
