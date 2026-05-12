---
'@solvapay/react': minor
---

Add step-aware heading + subheading primitives to `<CheckoutSteps>`. `<CheckoutSteps.StepHeading>` and `<CheckoutSteps.StepMessage>` resolve copy from the active `flow.step` and `flow.branch` (and the selected plan's `billingCycle`), so the chrome at the top of the embedded checkout updates as the customer progresses through plan -> amount -> payment. New `checkout.stepHeading.{plan,amount,payment}` and `checkout.stepMessage.{plan,amount,paymentRecurring,paymentOneTime,paymentPayg}` keys ship with sensible English defaults; the `paymentRecurring` key interpolates `{planName}` from the selected plan.

```tsx
<CheckoutSteps.Root productRef={productRef} returnUrl={url}>
  <CheckoutSteps.StepHeading className="my-heading" />
  <CheckoutSteps.StepMessage className="my-subheading" />
  <CheckoutSteps.IfStep step="plan">{/* … */}</CheckoutSteps.IfStep>
  {/* … */}
</CheckoutSteps.Root>
```

When nested inside `<PaywallNotice.Root>`, the `plan` step heading + message defer to the existing `paywall.{paymentRequired,activationRequired,topupRequired}Heading` / `resolvePaywallMessage` so the gate-reason framing the customer saw on entry stays intact. Outside paywall context the fallback `checkout.stepHeading.plan` ("Choose your plan") is used.

`<PaywallNotice.EmbeddedCheckout>` now renders `<CheckoutSteps.StepHeading>` + `<CheckoutSteps.StepMessage>` at the top of its internal stepped composition by default, passing through the consumer's `classNames.heading` / `classNames.message` overrides. Integrators who already render `<PaywallNotice.Heading>` + `<PaywallNotice.Message>` as siblings of `<EmbeddedCheckout>` (the previous documented pattern) will see duplicated text — drop the outer parts and rely on the in-flow defaults, or stop using `<PaywallNotice.EmbeddedCheckout>` and compose `<CheckoutSteps.*>` directly to keep full layout control.

Resolves the stale "Pick a plan below to keep chatting." subheading shown on the lifetime-access checkout once the user had progressed past the plan step, and the equivalent staleness on the proactive upgrade path in the chat-checkout demo.
