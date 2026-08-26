---
'@solvapay/react': patch
---

PAYG embedded checkout now activates first, then shows the credit top-up picker only when the wallet is empty.

A funded wallet skips the amount and payment steps. `ActivationFlow` follows the same contract: API `activated` at zero credits opens the amount picker instead of firing `onSuccess`. Once the customer is on the amount or payment step, a later zero-credit balance refetch no longer rewinds them back to the picker.
