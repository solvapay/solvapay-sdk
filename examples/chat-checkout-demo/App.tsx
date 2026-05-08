import React, { useCallback, useMemo, useState } from 'react'
import {
  getOrCreateAnonymousCustomerRef,
  useAutoActivateFreePlan,
  useLimits,
  usePlans,
  usePurchase,
} from '@solvapay/react'
import type { PaywallStructuredContent } from '@solvapay/server'
import { Message as MessageType, UserType, ScenarioType } from './types'
import { useFocusBus } from './components/focus/FocusProvider'
import { ChatWindow } from './components/ChatWindow'
import type { InlineCheckoutMode } from './components/InlineCheckout'
import { env } from './src/lib/env'

function getActivePurchaseFor(
  purchases: Array<{ planSnapshot?: { planType?: string }; status?: string; endDate?: string }>,
  planType: 'recurring' | 'one-time',
): boolean {
  const now = Date.now()
  return purchases.some(p => {
    if (p.planSnapshot?.planType !== planType) return false
    if (p.status !== 'active') return false
    if (p.endDate && new Date(p.endDate).getTime() <= now) return false
    return true
  })
}

function productRefForScenario(scenario: ScenarioType): string {
  switch (scenario) {
    case ScenarioType.SUBSCRIPTION:
      return env.subscription.productRef
    case ScenarioType.LIFETIME:
      return env.lifetime.productRef
    case ScenarioType.TOPUP:
      return env.topup.productRef
  }
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<MessageType[]>([])
  const [isBotThinking, setIsBotThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFirstMessage, setIsFirstMessage] = useState(true)
  const [currentScenario, setCurrentScenario] = useState<ScenarioType>(ScenarioType.SUBSCRIPTION)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  // Discriminated union — either a real 402 paywall (`paywall`) drives
  // `<PaywallNotice.EmbeddedCheckout>`, or a proactive "Upgrade" click
  // (`upgrade`) drives a bare `<CheckoutSteps.*>` composition. Earlier
  // revisions minted a synthetic `payment_required` block for the
  // upgrade case; routing on `mode` keeps the paywall surface honest.
  const [checkoutState, setCheckoutState] = useState<InlineCheckoutMode | null>(null)
  const { requestChatInputFocus } = useFocusBus()

  const customerRef = useMemo(() => getOrCreateAnonymousCustomerRef(), [])

  const { purchases, loading: purchaseLoading } = usePurchase()

  const isPremium = useMemo(() => getActivePurchaseFor(purchases, 'recurring'), [purchases])
  const hasLifetimeAccess = useMemo(() => getActivePurchaseFor(purchases, 'one-time'), [purchases])

  const productRef = productRefForScenario(currentScenario)

  // Backend-authoritative remaining for the active product/meter. Drives
  // the "X left" pill across all three scenarios (subscription free tier,
  // lifetime free tier, topup PAYG balance) — replaces both the local
  // `userMessageCount` ref counter and the `floor(credits/creditsPerUnit)`
  // derivation. `adjustRemaining(-1)` after each successful send applies
  // an 8s optimistic grace window before refetching, matching the SDK's
  // `adjustBalance` pattern.
  const {
    remaining: limitRemaining,
    refetch: refetchLimits,
    adjustRemaining,
  } = useLimits({
    productRef: productRef || undefined,
    meterName: 'requests',
  })

  // Plans still drive the tooltip copy ("Free up to N messages",
  // "Pay-as-you-go: N credits per message"). Limits is the *runtime*
  // counter; plans are the *configuration*.
  const { plans, loading: plansLoading } = usePlans({
    productRef: productRef || undefined,
  })
  const messageLimit = useMemo(() => {
    const free = plans
      .map(p => p.freeUnits ?? 0)
      .filter(n => n > 0)
      .sort((a, b) => b - a)[0]
    return free ?? 0
  }, [plans])

  // Silently flip the customer onto the product's free plan when the
  // backend reports `activationRequired`. Without this, fresh customers
  // on a product whose default plan needs explicit activation see "0
  // left" until they trip a 402 — the free tier is there, just not yet
  // claimed. PAYG-only products (no free plan to activate) keep
  // `pending: false` so the pill commits to the real backend value.
  const { pending: autoActivatingFreePlan } = useAutoActivateFreePlan({
    productRef: productRef || undefined,
  })

  const processMessage = useCallback(
    async (message: string, history: MessageType[], opts?: { retryOn402?: number }) => {
      if (!productRef) {
        setError(
          `No product configured for the ${currentScenario} scenario. Set the matching VITE_*_PRODUCT_REF in .env.`,
        )
        return
      }

      setIsBotThinking(true)
      setError(null)

      const wireMessages = [
        ...history.map(m => ({
          role: m.sender === UserType.BOT ? ('bot' as const) : ('user' as const),
          text: m.text,
        })),
        { role: 'user' as const, text: message },
      ]

      const maxAttempts = (opts?.retryOn402 ?? 0) + 1

      try {
        // Silent 402-retry loop. The post-purchase replay (see
        // `handleFormSuccess`) races the SolvaPay webhook that credits
        // the customer (~1-3s, occasionally longer) — without backoff
        // the chat would flicker right back to the paywall notice
        // before the wallet is fully credited server-side. 1+2+3+4s
        // covers typical webhook latency. Non-replay sends pass no
        // `retryOn402` and surface the gate immediately.
        let response: Response | null = null
        let payload402: PaywallStructuredContent | null = null
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-customer-ref': customerRef,
            },
            body: JSON.stringify({ productRef, messages: wireMessages }),
          })

          if (response.status !== 402) break

          payload402 = (await response.json()) as PaywallStructuredContent

          if (attempt < maxAttempts - 1) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 1000))
            response = null
          }
        }

        if (response?.status === 402 && payload402) {
          // The server emitted a structured paywall — open the inline
          // drawer at the `notice` stage so the user sees the
          // educational "Out of credits" / "Free limit reached" /
          // "Free use exceeded" strip first, then clicks the CTA to
          // expand into `<PaywallNotice.EmbeddedCheckout>`. The
          // pending message replays automatically once
          // `usePaywallResolver` flips `resolved`.
          setCheckoutState({ mode: 'paywall', stage: 'notice', content: payload402 })
          setPendingMessage(message)
          setIsBotThinking(false)
          return
        }

        if (!response || !response.ok || !response.body) {
          throw new Error(`Chat request failed: ${response?.status ?? 'no response'}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let botResponse = ''
        const botMessageId = Date.now() + 1
        let firstChunk = true

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            let event: { chunk?: string; error?: string }
            try {
              event = JSON.parse(line) as { chunk?: string; error?: string }
            } catch {
              continue
            }
            if (event.error) {
              throw new Error(event.error)
            }
            if (!event.chunk) continue
            botResponse += event.chunk
            if (firstChunk) {
              setMessages(prev => [
                ...prev,
                { id: botMessageId, text: botResponse, sender: UserType.BOT },
              ])
              firstChunk = false
            } else {
              setMessages(prev =>
                prev.map(m => (m.id === botMessageId ? { ...m, text: botResponse } : m)),
              )
            }
          }
        }

        // Each chat send debits one unit from the active meter on the
        // backend (via `trackUsage` in the chat handler). Optimistically
        // nudge the local counter so the pill reacts instantly; the
        // hook's 8s grace window then refetches to converge on the
        // authoritative value.
        adjustRemaining(-1)
      } catch (e) {
        const errorMessage = 'An error occurred while fetching the response. Please try again.'
        setError(errorMessage)
        setMessages(prev => [
          ...prev,
          { id: Date.now() + 1, text: errorMessage, sender: UserType.BOT },
        ])
        console.error(e)
      } finally {
        setIsBotThinking(false)
      }
    },
    [productRef, currentScenario, customerRef, adjustRemaining],
  )

  const handleSendMessage = (message: string) => {
    // Capture history from the component closure (pre-update value),
    // then schedule the optimistic append. The network call MUST stay
    // outside the `setMessages` updater — React Strict Mode
    // double-invokes state updaters in dev, which would fire
    // `/api/chat` twice and produce duplicate bot replies.
    void processMessage(message, messages)
    setMessages(prev => [...prev, { id: Date.now(), text: message, sender: UserType.USER }])
    setIsFirstMessage(false)
  }

  /**
   * The user clicked "Upgrade" before hitting a real 402. Open the
   * stepped checkout drawer in `upgrade` mode — no synthetic
   * paywall content needed. `<CheckoutSteps.*>` drives the plan →
   * amount → payment flow and `onPurchaseSuccess` calls back into
   * `handleFormSuccess`.
   */
  const handleUpgrade = () => {
    if (!productRef) return
    setIsFirstMessage(false)
    setCheckoutState({ mode: 'upgrade', productRef })
  }

  /**
   * The user clicked the CTA on the pre-checkout notice strip. Flip
   * the paywall drawer from `stage: 'notice'` to `stage: 'checkout'`
   * so `<InlineCheckout>` mounts `<PaywallNotice.EmbeddedCheckout>`.
   * No-op on the proactive `'upgrade'` branch (which goes straight
   * to the form and never sits in `'notice'`).
   */
  const handleUnlock = useCallback(() => {
    setCheckoutState(prev =>
      prev && prev.mode === 'paywall' ? { ...prev, stage: 'checkout' } : prev,
    )
  }, [])

  const handleFormSuccess = () => {
    setCheckoutState(null)

    // Poll the limits for ~10s so the header pill converges on the
    // real backend value once the webhook lands. The hook's 10s cache
    // TTL can otherwise hide a slow webhook from the badge.
    for (const ms of [1000, 3000, 6000, 10000]) {
      window.setTimeout(() => {
        refetchLimits().catch(() => {})
      }, ms)
    }

    if (pendingMessage) {
      const retry = pendingMessage
      setPendingMessage(null)
      // The SolvaPay webhook that credits the customer fires async
      // after Stripe confirms (typically 1-3s, occasionally longer).
      // `/api/chat` is gated server-side via `checkLimits`, so the
      // first replay can race the webhook and trip another 402. Ride
      // the silent retry path in `processMessage` (~10s of total
      // wait) instead of immediately flicking back to the paywall
      // notice.
      processMessage(retry, messages, { retryOn402: 4 }).catch(() => {})
    }
    requestChatInputFocus()
  }

  const handleReset = () => {
    // Transcript-only reset — backend usage is preserved (the customer
    // is the same; only the visible chat clears). `useLimits` keeps its
    // cached `remaining` so the pill stays honest across resets.
    setMessages([])
    setIsFirstMessage(true)
    setPendingMessage(null)
    setCheckoutState(null)
    requestChatInputFocus()
  }

  const handleScenarioChange = (scenario: ScenarioType) => {
    // `useLimits` re-keys on `productRef` change automatically, so each
    // scenario picks up its own backend-authoritative remaining without
    // any local plumbing.
    setCurrentScenario(scenario)
    setMessages([])
    setIsFirstMessage(true)
    setPendingMessage(null)
    setCheckoutState(null)
    requestChatInputFocus()
  }

  return (
    <div className="h-screen w-screen flex flex-col font-sans bg-gradient-to-br from-slate-50 to-slate-100/50">
      <div className="flex justify-center pt-3 pb-1 px-4">
        <div className="flex bg-white/80 backdrop-blur-sm rounded-full p-1 shadow-sm border border-slate-200/60 gap-1">
          {[
            { id: ScenarioType.SUBSCRIPTION, label: 'Upgrade to Subscription' },
            { id: ScenarioType.TOPUP, label: 'Top Up Credits' },
            { id: ScenarioType.LIFETIME, label: 'Lifetime Access' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => handleScenarioChange(id)}
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
                currentScenario === id
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <main className="flex-1 overflow-hidden p-3 md:p-6 pt-2">
        <div className="h-full w-full max-w-5xl mx-auto bg-white/95 rounded-2xl shadow-xl border border-slate-200/60 flex flex-col backdrop-blur-lg">
          <ChatWindow
            messages={messages}
            isBotThinking={isBotThinking}
            onSendMessage={handleSendMessage}
            onUpgrade={handleUpgrade}
            limitRemaining={limitRemaining}
            autoActivatingFreePlan={autoActivatingFreePlan}
            purchaseLoading={purchaseLoading}
            messageLimit={messageLimit}
            plans={plans}
            plansLoading={plansLoading}
            onReset={handleReset}
            isFirstMessage={isFirstMessage}
            isPremium={isPremium}
            currentScenario={currentScenario}
            hasLifetimeAccess={hasLifetimeAccess}
            checkoutState={checkoutState}
            onFormSuccess={handleFormSuccess}
            onUnlock={handleUnlock}
          />
        </div>
        {error && (
          <div
            className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg"
            role="alert"
          >
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
