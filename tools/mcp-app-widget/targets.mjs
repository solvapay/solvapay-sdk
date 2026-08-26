export const CANONICAL_REL = 'tools/mcp-app-widget/mcp-app.html'
export const DIST_REL = 'tools/mcp-app-widget/dist/mcp-app.html'

export const SDK_COPIES = [
  'sdks/python-mcp/python/solvapay_mcp/data/mcp-app.html',
  'sdks/ruby-mcp/lib/solvapay/mcp/data/mcp-app.html',
  'sdks/go/mcp/mcp-app.html',
  'sdks/rust-mcp/mcp-app.html',
  'sdks/typescript/mcp/mcp-app.html',
]

export const VENDOR_TARGETS = [CANONICAL_REL, ...SDK_COPIES]
