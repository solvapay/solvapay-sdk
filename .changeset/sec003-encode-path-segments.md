---
'@solvapay/server': patch
---

HTTP path segments for customer, product, plan, purchase, and payment-intent refs are now percent-encoded (`encodeURIComponent` semantics) so a slash or `..` in a ref cannot rewrite the request path under the merchant secret key.
