---
'@solvapay/react': patch
---

`PaymentForm` and `TopupForm` repaint Stripe's card fields when the host switches theme with a class or attribute, such as `class="dark"` or `data-theme="dark"` on `<html>`, `<body>` or a wrapper above the form. Before, the card fields only followed the operating system's light or dark setting and kept the old colours until the page reloaded.
