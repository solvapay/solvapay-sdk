# Auto-Recharge UI — layout reference

Design reference for the automatic credit top-up surface (`AutoRecharge` primitive,
`packages/react/src/primitives/AutoRecharge.tsx`). The mockups below are HTML + inline
CSS so they render as real UI in the markdown preview (open this file's preview pane).

> Tip: VS Code / Cursor markdown preview renders inline styles. GitHub strips most CSS,
> so view this locally for the styled version.

## Where the convention comes from

Auto-recharge is not a UI that payment infrastructure ships — it is a product pattern.

| Source | Ships an auto-recharge UI? | Notes |
| --- | --- | --- |
| **Stripe** | No | Billing credits + credit-grant ledger only. You build threshold-watching + recharge. |
| **Polar** | No | Credits + meters + Customer Portal *displays* balance; top-up logic is yours. |
| **Metronome / Stigg / Flexprice** | Yes | Same 2 knobs: threshold and fixed recharge amount, payment gating. |
| **OpenAI / Anthropic / Cursor / Twilio** | Yes | The de-facto visual reference everyone copies. |

References: [OpenAI prepaid billing](https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing) ·
[Metronome thresholds](https://docs.metronome.com/guides/customers-billing/optimize-customer-experience/prepaid-balance-thresholds) ·
[Stripe billing credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits) ·
[Polar credits](https://polar.sh/docs/features/usage-based-billing/credits)

---

## 1. Closed state — summary card

The default `<AutoRecharge />` drop-in renders a compact card. Clicking **Set up auto-recharge** or **Modify** opens the settings dialog.

<div style="max-width:460px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#ffffff;box-shadow:0 1px 3px rgba(15,23,42,.08)">
  <div style="font-size:15px;font-weight:600;color:#0f172a;margin-bottom:6px">Auto recharge</div>
  <div style="font-size:13px;color:#64748b;line-height:1.5;margin-bottom:12px">When your credit balance falls below a threshold, your saved payment method will be charged to bring it back up.</div>
  <button style="border:none;background:#0f172a;color:#fff;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:500;cursor:pointer">Set up auto-recharge</button>
</div>

---

## 2. Settings dialog — enabled

Modal with checkbox opt-in, stacked fields (label / input / helper), and **Cancel** + **Save settings** buttons bottom-right.

<div style="position:relative;max-width:520px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="position:absolute;inset:-20px -20px -20px -20px;background:rgba(15,23,42,.45);border-radius:16px"></div>
  <div style="position:relative;background:#fff;border-radius:12px;padding:24px;box-shadow:0 10px 25px rgba(15,23,42,.15)">
    <div style="font-size:18px;font-weight:600;color:#0f172a;margin-bottom:16px">Auto recharge settings</div>
    <div style="font-size:14px;font-weight:500;color:#0f172a;margin-bottom:10px">Would you like to set up automatic recharge?</div>
    <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:20px">
      <input type="checkbox" checked style="margin-top:3px;accent-color:#10b981" />
      <span style="font-size:14px;color:#0f172a;line-height:1.5">Yes, automatically recharge my card when my credit balance falls below a threshold</span>
    </div>
    <div style="margin-bottom:16px">
      <div style="font-size:14px;font-weight:500;color:#0f172a;margin-bottom:8px">When balance falls below</div>
      <div style="display:flex;align-items:center;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px">
        <span style="color:#64748b;margin-right:4px">$</span>
        <span style="flex:1;font-size:16px;color:#0f172a">5</span>
      </div>
    </div>
    <div style="margin-bottom:20px">
      <div style="font-size:14px;font-weight:500;color:#0f172a;margin-bottom:8px">Add this amount</div>
      <div style="display:flex;align-items:center;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px">
        <span style="color:#64748b;margin-right:4px">$</span>
        <span style="flex:1;font-size:16px;color:#0f172a">10</span>
      </div>
      <div style="font-size:13px;color:#64748b;margin-top:6px">≈ 1,000 credits per recharge</div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button style="border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:9px 16px;font-size:14px;font-weight:500;cursor:pointer">Cancel</button>
      <button style="border:none;background:#0f172a;color:#fff;border-radius:8px;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer">Save settings</button>
    </div>
  </div>
</div>

---

## 3. First-time setup (`dataState === 'setup'`, no saved card)

The Stripe `PaymentElement` mounts inline inside the dialog; the CTA becomes **Set up auto-recharge**.

<div style="max-width:460px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;border:1px solid #e2e8f0;border-radius:12px;padding:20px;background:#ffffff;box-shadow:0 1px 3px rgba(15,23,42,.08)">
  <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Payment method</div>
  <div style="border:1px dashed #cbd5e1;background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:8px">
    <div style="height:38px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;margin-bottom:10px;display:flex;align-items:center;padding:0 12px;color:#94a3b8;font-size:13px">Card number</div>
    <div style="display:flex;gap:10px">
      <div style="flex:1;height:38px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;display:flex;align-items:center;padding:0 12px;color:#94a3b8;font-size:13px">MM / YY</div>
      <div style="flex:1;height:38px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;display:flex;align-items:center;padding:0 12px;color:#94a3b8;font-size:13px">CVC</div>
    </div>
  </div>
  <div style="font-size:11px;color:#94a3b8;margin-bottom:16px">Secured by Stripe</div>
  <button style="width:100%;border:none;background:#0f172a;color:#fff;border-radius:8px;padding:11px;font-size:14px;font-weight:600;cursor:pointer">Set up auto-recharge</button>
</div>

---

## 4. Failed recharge banner (`status !== 'active'` / `failureCount > 0`)

Shown on the summary card when auto-recharge is paused.

<div style="max-width:460px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start">
  <div style="flex:none;width:22px;height:22px;border-radius:50%;background:#dc2626;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:14px">!</div>
  <div>
    <div style="font-size:14px;font-weight:600;color:#b91c1c">Auto-recharge paused</div>
    <div style="font-size:13px;color:#991b1b;margin-top:2px">Your last recharge failed. Update your payment method to re-enable automatic top-ups.</div>
    <button style="margin-top:10px;border:1px solid #dc2626;background:#fff;color:#b91c1c;border-radius:7px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer">Update card</button>
  </div>
</div>

---

## Field spec (mapped to `AutoRechargeConfig`)

| UI field | Form state | Config path | Default | Rules |
| --- | --- | --- | --- | --- |
| Enable checkbox | `enabled` | `enabled` | `false` (opt-in) | Off by default; threshold and amount fields stay hidden until checked |
| Threshold | `thresholdAmountMajor` + `thresholdUnit` | `trigger.thresholdAmountMinor` | `5` | Stored in display-currency minor units; entered in $ or credits |
| Fixed amount | `topupAmountMajor` + `topupUnit` | `topup.amountMinor` | `10` | ≥ minimum charge |
| Payment method | Stripe `PaymentElement` | — | — | Required before enable |
| Summary | `summaryLine` (`buildSummaryLine`) | derived | — | Updates live |

## States

`dataState: 'loading' | 'idle' | 'saving' | 'disabling' | 'setup' | 'error'`

| State | UI |
| --- | --- |
| `loading` | Skeleton / `Spinner` on summary card |
| `setup` | First-time: PaymentElement inline in dialog, CTA "Set up auto-recharge" (mockup 3) |
| `idle` | Summary card + dialog for editing (mockup 2) |
| `saving` | Save button → spinner, fields disabled |
| `disabling` | Disable in progress |
| `error` | Inline error banner with retry; never silently fail |
| failed recharge | `status`/`failureCount` → warning banner on card (mockup 4) |

## Mapping to the compound primitive

```
<AutoRecharge.Root>
  <AutoRecharge.Card />           // closed-state summary
    <AutoRecharge.CardHeading />
    <AutoRecharge.CardSummary />
    <AutoRecharge.Trigger />      // opens dialog
  <AutoRecharge.Content />        // portal dialog
    <AutoRecharge.Title />
    <AutoRecharge.EnableQuestion />
    <AutoRecharge.EnableRow />    // checkbox + sentence
    <AutoRecharge.Body>
      <AutoRecharge.ThresholdField />
      <AutoRecharge.TopupField />
      <AutoRecharge.Actions>
        <AutoRecharge.CancelButton />
        <AutoRecharge.SaveButton />
      </AutoRecharge.Actions>
    </AutoRecharge.Body>
  <AutoRecharge.Error />
</AutoRecharge.Root>
```
