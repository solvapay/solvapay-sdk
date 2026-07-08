---
'@solvapay/react': minor
'@solvapay/server': minor
---

Surface seller VAT / tax identity in the SDK. The merchant contract now exposes optional `companyNumber`, `taxId`, and `vatNumber`, and `McpSellerDetailsCard` renders a country-smart tax-identifier row (VAT number for EU/GB, EIN/Tax ID otherwise) plus a company-number line with org-vs-tax de-duplication.
