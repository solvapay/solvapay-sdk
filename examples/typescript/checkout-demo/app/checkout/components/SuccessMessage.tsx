/**
 * Success Message Component
 *
 * Displays payment success confirmation
 */
export function SuccessMessage() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg
          className="w-8 h-8 text-green-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-2xl font-semibold text-slate-900 mb-2">Payment Successful!</h2>
      <p className="text-slate-600 mb-4">Your purchase has been activated.</p>
      <p className="text-sm text-slate-500">Redirecting to home page...</p>
    </div>
  )
}
