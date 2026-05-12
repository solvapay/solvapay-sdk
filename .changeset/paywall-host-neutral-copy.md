---
'@solvapay/react': patch
---

`<PaywallNotice>` copy is now host-neutral and topup-aware.

The default i18n strings used to leak MCP framing ("This tool needs an active plan…") into web surfaces. They've been rewritten in second person and split so the heading/message track whether the gate calls for a real plan or just more credits.

### Copy changes

| Key | Before | After |
| --- | --- | --- |
| `paywall.activationRequiredHeading` | `Add credits to continue` | `Activate a plan to continue` |
| `paywall.activationRequiredMessage` | `This tool needs an active plan{forProduct}. Pick one below to keep going.` | `You need an active plan{forProduct} to continue. Pick one below.` |
| `paywall.topupRequiredHeading` (new) | — | `Add credits to continue` |

`paywall.topupRequiredMessage` (`You're out of credits{forProduct}. Add more below to keep going.`) is unchanged — it now actually gets used.

### Routing

`<PaywallNotice.Heading>` and `<PaywallNotice.Message>` distinguish the topup variant of an `activation_required` gate from a subscription/lifetime activation. When every plan on `content.plans` has `type: 'usage-based' | 'hybrid'` (PAYG-only), they resolve to the topup heading + message; otherwise they resolve to the activation heading + message. `payment_required` is unchanged.

### Migration

Integrators relying on the default `activationRequiredHeading` text get the corrected copy automatically. Integrators overriding `paywall.*` strings via the i18n bundle keep working — only one new optional key (`topupRequiredHeading`) was added; the runtime falls back to it for PAYG-only gates and `activationRequiredHeading` everywhere else.
