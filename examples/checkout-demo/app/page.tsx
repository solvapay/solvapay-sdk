'use client'

import { useCallback } from 'react'
import { usePurchase, usePlans, usePurchaseStatus } from '@solvapay/react'
import Link from 'next/link'

export default function HomePage() {
  const productRef = process.env.NEXT_PUBLIC_PRODUCT_REF

  // Memoize the fetcher function to prevent unnecessary re-fetches
  const fetchPlans = useCallback(async (productRef: string) => {
    const response = await fetch(`/api/list-plans?productRef=${productRef}`)
    if (!response.ok) throw new Error('Failed to fetch plans')
    const data = await response.json()
    return data.plans || []
  }, [])

  // Fetch plans using SDK hook
  const { loading: plansLoading } = usePlans({
    productRef: productRef || undefined,
    fetcher: fetchPlans,
  })

  // Get purchase helpers from SDK
  // Note: Plans are handled on the checkout page, so we pass empty array
  // Purchase status is determined by amount field: amount > 0 = paid, amount === 0 or undefined = free
  // Use hasPaidPurchase and activePurchase consistently throughout the component
  // Note: Provider auto-fetches purchases on mount, so no manual refetch needed here
  const {
    loading: purchasesLoading,
    hasPaidPurchase,
    activePurchase,
  } = usePurchase()

  // Get advanced purchase status helpers
  const { cancelledPurchase, shouldShowCancelledNotice, formatDate, getDaysUntilExpiration } =
    usePurchaseStatus()

  // Combine loading states - only show content when both are loaded
  const isLoading = purchasesLoading || plansLoading

  const FeatureCard = ({
    title,
    description,
    locked = false,
  }: {
    title: string
    description: string
    locked?: boolean
  }) => (
    <div
      className={`p-6 rounded-xl border ${locked ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'} relative`}
    >
      {locked && (
        <div className="absolute top-4 right-4">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            Premium
          </span>
        </div>
      )}
      <h3 className={`text-lg font-medium mb-2 ${locked ? 'text-slate-500' : 'text-slate-900'}`}>
        {title}
      </h3>
      <p className={`text-sm ${locked ? 'text-slate-400' : 'text-slate-600'}`}>{description}</p>
      {locked && (
        <div className="mt-4">
          <svg
            className="w-5 h-5 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
      )}
    </div>
  )

  // Skeleton loader component
  const Skeleton = ({ className = '' }: { className?: string }) => (
    <div className={`animate-pulse bg-slate-200 rounded ${className}`} />
  )

  return (
    <div className="min-h-screen bg-white">
      <main className="max-w-4xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-semibold text-slate-900 mb-3">Welcome to Your Dashboard</h1>
          {isLoading ? (
            <div className="flex justify-center items-center gap-2">
              <Skeleton className="h-5 w-48" />
            </div>
          ) : activePurchase ? (
            <p className="text-slate-600">
              You're on the{' '}
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                {activePurchase.planName}
              </span>{' '}
              plan
            </p>
          ) : shouldShowCancelledNotice && cancelledPurchase ? (
            <div className="space-y-2">
              <p className="text-slate-600">
                Your{' '}
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                  {cancelledPurchase.planName}
                </span>{' '}
                purchase has been cancelled
              </p>
              {cancelledPurchase.endDate ? (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm font-medium text-amber-900">
                    ⏰ Access expires on {formatDate(cancelledPurchase.endDate)}
                  </p>
                  {(() => {
                    const daysLeft = getDaysUntilExpiration(cancelledPurchase.endDate)
                    return daysLeft !== null && daysLeft > 0 ? (
                      <p className="text-xs text-amber-700 mt-1">
                        {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
                      </p>
                    ) : null
                  })()}
                  <p className="text-xs text-amber-700 mt-1">
                    You'll continue to have access to {cancelledPurchase.planName} features
                    until this date
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-500 mt-1">Your purchase access has ended</p>
              )}
              {cancelledPurchase.cancelledAt && (
                <p className="text-xs text-slate-400 mt-2">
                  Cancelled on {formatDate(cancelledPurchase.cancelledAt)}
                  {cancelledPurchase.cancellationReason &&
                    ` - ${cancelledPurchase.cancellationReason}`}
                </p>
              )}
            </div>
          ) : (
            <p className="text-slate-600">You don't have an active purchase</p>
          )}
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <FeatureCard
            title="Basic Analytics"
            description="View your daily stats and basic metrics."
          />
          <FeatureCard
            title="Standard Reports"
            description="Generate monthly reports with key insights."
          />
          <FeatureCard
            title="Advanced Analytics"
            description="Real-time data analysis with custom dashboards."
            locked={!isLoading && !hasPaidPurchase}
          />
          <FeatureCard
            title="Priority Support"
            description="Get help from our team within 24 hours."
            locked={!isLoading && !hasPaidPurchase}
          />
        </div>

        {/* CTA Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {isLoading ? (
            <div className="text-center py-4 space-y-4">
              <Skeleton className="h-5 w-64 mx-auto" />
              <Skeleton className="h-10 w-48 mx-auto" />
            </div>
          ) : hasPaidPurchase ? (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-4">Manage your purchase and billing</p>
              <Link href="/checkout">
                <button className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                  Manage Purchase
                </button>
              </Link>
            </div>
          ) : shouldShowCancelledNotice && cancelledPurchase ? (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-2 font-medium">Your purchase is cancelled</p>
              {cancelledPurchase.endDate ? (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm font-semibold text-amber-900 mb-1">
                    ⏰ Purchase Expires: {formatDate(cancelledPurchase.endDate)}
                  </p>
                  {(() => {
                    const daysLeft = getDaysUntilExpiration(cancelledPurchase.endDate)
                    return daysLeft !== null && daysLeft > 0 ? (
                      <p className="text-xs text-amber-700 mb-1">
                        {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
                      </p>
                    ) : null
                  })()}
                  <p className="text-xs text-amber-700">
                    You'll continue to have access to {cancelledPurchase.planName} features
                    until this date
                  </p>
                </div>
              ) : (
                <p className="text-slate-600 text-sm mb-6">Your purchase access has ended</p>
              )}
              <Link href="/checkout">
                <button className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                  Purchase Again
                </button>
              </Link>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-2 font-medium">Upgrade your plan</p>
              <p className="text-slate-600 text-sm mb-6">
                Get access to advanced features and more
              </p>
              <Link href="/checkout">
                <button className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                  Upgrade
                </button>
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
