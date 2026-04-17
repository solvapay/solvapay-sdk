import Link from 'next/link'

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
        SolvaPay Tailwind example
      </h1>
      <p className="mt-3 text-slate-600">
        Primitive-only checkout composed with Tailwind v4 utilities and{' '}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">data-[state=X]:</code>{' '}
        variants. No <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">styles.css</code>{' '}
        import — every pixel is styled in userspace.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link
          href="/checkout"
          className="rounded-xl border border-slate-200 p-6 transition hover:border-slate-400 hover:shadow-sm"
        >
          <h2 className="text-lg font-medium text-slate-900">Checkout →</h2>
          <p className="mt-2 text-sm text-slate-600">
            Pick a plan, pay, and activate — composed from{' '}
            <code>PlanSelector</code> + <code>PaymentForm</code>.
          </p>
        </Link>
        <Link
          href="/topup"
          className="rounded-xl border border-slate-200 p-6 transition hover:border-slate-400 hover:shadow-sm"
        >
          <h2 className="text-lg font-medium text-slate-900">Top up →</h2>
          <p className="mt-2 text-sm text-slate-600">
            Add credits using <code>AmountPicker</code> + <code>TopupForm</code>.
          </p>
        </Link>
      </div>
    </main>
  )
}
