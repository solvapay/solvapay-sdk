---
'@solvapay/react': patch
---

Stop seller-card email and support URL from navigating the MCP widget iframe. `mailto:` and `target="_blank"` anchors were landing the sandboxed frame on a blocked page with no way back; both rows now render as plain `DetailRow` text, matching the customer-card email.
