---
'@solvapay/react': patch
---

The MCP widget footer now reads `Provided by SolvaPay   Terms   Privacy` as one muted line with no `·` separators. `Provided by SolvaPay` is plain text instead of a link to solvapay.com; Terms and Privacy still link to SolvaPay's legal pages. The `<LegalFooter>` primitive's separator span now carries `data-solvapay-legal-footer-separator` so shells can style or hide it; its default rendering is unchanged.
