---
'@solvapay/react': patch
---

Vault card capture no longer sends `meta` with `createCard`: VGS Collect writes its own card meta, so the payment id never landed on the card. `captureCard(form, grant)` sends `{ auth, data: {} }`, and the backend binds the card to the payment at confirm (captured inside the payment's grant window, used once). The fake Collect in `@solvapay/test-utils` records each card's `createCard` options exactly (`card.options`) instead of `meta`/`auth`.
