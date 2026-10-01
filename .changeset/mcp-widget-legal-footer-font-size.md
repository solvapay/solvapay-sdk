---
'@solvapay/react': patch
---

The MCP widget legal footer now follows the widget's type scale. The shared footer sizes in rem, which assumes a 16px root; the widget root is 14px, so the line was larger than the shell's 12px.
