---
'@solvapay/react': patch
---

The drop-in `<TopupForm>` renders the buyer's country (and US state and ZIP) fields; without them its submit button could never be enabled. `<AutoRecharge>`'s card setup lets Stripe's Payment Element collect the billing address, since the form has no SolvaPay country field and `stripe.confirmSetup()` threw for a missing country; an error thrown during setup is now shown instead of leaving the button on "Authorizing…".
