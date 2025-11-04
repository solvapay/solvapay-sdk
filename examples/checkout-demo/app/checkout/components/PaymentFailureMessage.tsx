import Link from 'next/link';

/**
 * Payment Failure Message Component
 * 
 * Displays a user-friendly message when payment processing fails.
 * Technical details are logged to console for developers.
 */
export function PaymentFailureMessage() {
  return (
    <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-8 text-center">
      <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg 
          className="w-8 h-8 text-red-600" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M6 18L18 6M6 6l12 12" 
          />
        </svg>
      </div>
      <h2 className="text-2xl font-semibold text-slate-900 mb-2">
        Payment Processing Failed
      </h2>
      <div className="space-y-4">
        <p className="text-slate-600">
          We encountered an issue while processing your payment. Your card was not charged.
        </p>
        <p className="text-sm text-slate-500">
          Please try again or contact support if the problem persists.
        </p>
        <div className="flex gap-4 justify-center pt-4">
          <Link href="/">
            <button className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
              Go to Home Page
            </button>
          </Link>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}

