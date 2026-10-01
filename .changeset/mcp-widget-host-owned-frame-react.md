---
'@solvapay/react': patch
---

The MCP widget no longer paints its own outer card border and radius, or a 16px gutter on `#root`. This fixes the double frame on Claude Desktop and ChatGPT, which frame the iframe themselves. The legal footer now sits directly under the surface card with a 16px bottom inset instead of floating 36px below the last control and flush against the host frame. The widget root also declares `scrollbar-width: none`: inline frames are sized to the content by the host, and Chromium (Claude Desktop) could otherwise keep a thumbless root scrollbar after a view grew in place, stealing 15px of layout width. Inline chrome, card and shell no longer cap themselves at a centered 760px: the host draws its frame at the full column width, so the cap showed as empty margins inside that frame on wide Claude Desktop windows.
