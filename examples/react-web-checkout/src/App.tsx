import { useMemo, useState } from 'react'
import {
  AutoRecharge,
  PaymentForm,
  SolvaPayProvider,
  formatPrice,
  getMinorUnitsPerMajor,
  useBalance,
  useMerchant,
  usePlans,
  usePurchase,
  usePurchaseActions,
  useTransport,
  type AuthAdapter,
  type Plan,
  type PurchaseInfo,
} from '@solvapay/react'
import { TopupForm } from '@solvapay/react/primitives'

interface Session {
  userId: string
  token: string
}

const SESSION_KEY = 'react-web-checkout-session'

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null // storage blocked: start signed out
  }
}

export function App({ productRef }: { productRef: string }) {
  const [session, setSession] = useState<Session | null>(readSession)

  const signOut = () => {
    sessionStorage.removeItem(SESSION_KEY)
    setSession(null)
  }

  if (!session) {
    return (
      <SignIn
        onSignedIn={s => {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
          setSession(s)
        }}
      />
    )
  }

  return (
    <main
      style={{ maxWidth: 720, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui' }}
    >
      <p>
        Signed in as <strong>{session.userId}</strong> <button onClick={signOut}>Sign out</button>
      </p>
      {/* Keyed by user so a new sign-in starts a fresh provider. */}
      <Checkout key={session.userId} session={session} productRef={productRef} />
    </main>
  )
}

/**
 * The demo login: the backend signs a short-lived token for whatever id is typed.
 * A real app signs people in with its own auth; the backend's get_user / GetUser
 * verifies that auth.
 */
function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [userId, setUserId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const response = await fetch('/auth/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const body = (await response.json()) as { token?: string; error?: string }
    if (!response.ok || !body.token) {
      setError(body.error ?? `Login failed (${response.status})`)
      return
    }
    onSignedIn({ userId, token: body.token })
  }

  return (
    <main style={{ maxWidth: 420, margin: '48px auto', fontFamily: 'system-ui' }}>
      <h1>React web checkout</h1>
      <form onSubmit={submit}>
        <label>
          User id{' '}
          <input
            value={userId}
            onChange={e => setUserId(e.target.value)}
            placeholder="proof-user-1"
            required
          />
        </label>{' '}
        <button type="submit">Sign in</button>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </main>
  )
}

function Checkout({ session, productRef }: { session: Session; productRef: string }) {
  // The only identity the backend gets is this bearer token.
  const adapter = useMemo<AuthAdapter>(
    () => ({
      getToken: async () => session.token,
      getUserId: async () => session.userId,
    }),
    [session],
  )

  return (
    <SolvaPayProvider config={{ auth: { adapter } }}>
      <MerchantLine />
      <Plans productRef={productRef} />
      <Purchases />
      <Credits />
      <History productRef={productRef} />
    </SolvaPayProvider>
  )
}

function MerchantLine() {
  const { merchant, error } = useMerchant()
  if (error) return <p style={{ color: 'crimson' }}>Merchant: {error.message}</p>
  return <p>Merchant: {merchant ? merchant.displayName : '…'}</p>
}

function planPrice(plan: Plan): string {
  if (typeof plan.price !== 'number' || !plan.currency) return 'price in options'
  return formatPrice(plan.price, plan.currency)
}

function Plans({ productRef }: { productRef: string }) {
  const { plans, loading, error } = usePlans({ productRef })
  const { refetch } = usePurchase()
  const [chosen, setChosen] = useState<string | null>(null)
  const [paid, setPaid] = useState<string | null>(null)

  return (
    <section>
      <h2>Plans</h2>
      {loading && <p>Loading plans…</p>}
      {error && <p style={{ color: 'crimson' }}>{error.message}</p>}
      <ul>
        {plans.map(plan => (
          <li key={plan.reference}>
            <label>
              <input
                type="radio"
                name="plan"
                checked={chosen === plan.reference}
                onChange={() => {
                  setChosen(plan.reference)
                  setPaid(null)
                }}
              />{' '}
              {plan.name ?? plan.reference} · {plan.type ?? 'no type'} · {planPrice(plan)}
            </label>
          </li>
        ))}
      </ul>
      {chosen && (
        <PaymentForm
          key={chosen}
          planRef={chosen}
          productRef={productRef}
          returnUrl={window.location.href}
          onResult={result => {
            // Only the outcome: the full result carries the payment intent's
            // client secret, which a page shouldn't print.
            const status = 'paymentIntent' in result ? result.paymentIntent?.status : undefined
            setPaid(`Checkout result: ${result.kind}${status ? ` (${status})` : ''}`)
            void refetch()
          }}
          onError={err => setPaid(`Checkout error: ${err.message}`)}
        />
      )}
      {paid && <p>{paid}</p>}
    </section>
  )
}

function Purchases() {
  const { purchases, loading, error, refetch } = usePurchase()
  const { cancelRenewal, reactivateRenewal, isCancelling, isReactivating } = usePurchaseActions()
  const [message, setMessage] = useState<string | null>(null)

  const act = async (label: string, run: () => Promise<unknown>) => {
    setMessage(null)
    try {
      await run()
      setMessage(`${label}: done`)
    } catch (err) {
      setMessage(`${label}: ${(err as Error).message}`)
    }
    await refetch()
  }

  return (
    <section>
      <h2>Current purchases</h2>
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>{error.message}</p>}
      {!loading && purchases.length === 0 && <p>No active purchases.</p>}
      <ul>
        {purchases.map((p: PurchaseInfo) => (
          <li key={p.reference}>
            {p.planSnapshot?.name ?? p.planRef ?? p.productName ?? p.reference} · {p.status} ·{' '}
            {formatPrice(p.amount, p.currency)}
            {p.isRecurring ? ' · recurring' : ''}
            {p.cancelledAt ? ` · renewal cancelled ${p.cancelledAt}` : ''}
            {p.isRecurring && p.status === 'active' && !p.cancelledAt && (
              <button
                disabled={isCancelling}
                onClick={() =>
                  act('Cancel renewal', () =>
                    cancelRenewal({ purchaseRef: p.reference, reason: 'Proof run' }),
                  )
                }
              >
                Cancel renewal
              </button>
            )}
            {p.isRecurring && p.cancelledAt && (
              <button
                disabled={isReactivating}
                onClick={() =>
                  act('Reactivate renewal', () => reactivateRenewal({ purchaseRef: p.reference }))
                }
              >
                Reactivate renewal
              </button>
            )}
          </li>
        ))}
      </ul>
      {message && <p>{message}</p>}
    </section>
  )
}

function Credits() {
  const balance = useBalance()
  const [amountMajor, setAmountMajor] = useState('10')
  const [showTopup, setShowTopup] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // The customer's balance currency; the top-up is charged in it.
  const currency = balance.displayCurrency
  const amountMinor = currency
    ? Math.round(Number(amountMajor) * getMinorUnitsPerMajor(currency))
    : 0

  return (
    <section>
      <h2>Credits</h2>
      <p>
        Balance:{' '}
        {balance.loading
          ? '…'
          : balance.credits === null
            ? 'none'
            : `${balance.credits} credits${balance.displayCurrency ? ` (${balance.displayCurrency})` : ''}`}
      </p>
      {!balance.loading && !currency && (
        <p style={{ color: 'crimson' }}>
          The balance has no display currency, so there is nothing to top up in.
        </p>
      )}
      <label>
        Top up ({currency ?? '…'}){' '}
        <input
          type="number"
          min="1"
          value={amountMajor}
          onChange={e => {
            setAmountMajor(e.target.value)
            setShowTopup(false)
          }}
        />
      </label>{' '}
      <button onClick={() => setShowTopup(true)} disabled={!currency || !(amountMinor > 0)}>
        Top up
      </button>
      {showTopup && currency && (
        // Composed from primitives: the drop-in <TopupForm> renders no address
        // fields, but submitting needs the buyer's country (and US state + ZIP).
        <TopupForm.Root
          key={amountMinor}
          amount={amountMinor}
          currency={currency}
          returnUrl={window.location.href}
          onSuccess={() => {
            setMessage('Top-up paid')
            setShowTopup(false)
            void balance.refetch()
          }}
          onError={err => setMessage(`Top-up error: ${err.message}`)}
        >
          <TopupForm.BusinessDetails.Root>
            <TopupForm.BusinessDetails.Fields />
          </TopupForm.BusinessDetails.Root>
          <TopupForm.PaymentElement />
          <TopupForm.Error />
          <TopupForm.SubmitButton>Pay top-up</TopupForm.SubmitButton>
        </TopupForm.Root>
      )}
      {message && <p>{message}</p>}
      <h3>Auto-recharge</h3>
      {currency && <AutoRecharge currency={currency} />}
    </section>
  )
}

function History({ productRef }: { productRef: string }) {
  // There is no exported history hook, so this calls the transport the provider uses.
  const transport = useTransport()
  const [history, setHistory] = useState<string | null>(null)

  const load = async () => {
    if (!transport.getHistory) {
      setHistory('This transport has no getHistory')
      return
    }
    try {
      setHistory(JSON.stringify(await transport.getHistory({ productRef }), null, 2))
    } catch (err) {
      setHistory(`History error: ${(err as Error).message}`)
    }
  }

  return (
    <section>
      <h2>History</h2>
      <button onClick={load}>Load history</button>
      {history && <pre style={{ fontSize: 12, overflowX: 'auto' }}>{history}</pre>}
    </section>
  )
}
