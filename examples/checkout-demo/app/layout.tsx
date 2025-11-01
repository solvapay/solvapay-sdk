'use client';

import { SolvaPayProvider } from '@solvapay/react';
import { useState, useEffect, useCallback } from 'react';
import { getOrCreateCustomerId, updateCustomerId } from './lib/customer';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [customerId, setCustomerId] = useState<string>('');

  // Initialize customer ID on mount
  useEffect(() => {
    setCustomerId(getOrCreateCustomerId());
  }, []);

  // Memoize callback functions to prevent unnecessary re-renders
  const handleCustomerRefUpdate = useCallback((newCustomerRef: string) => {
    // Update localStorage first
    updateCustomerId(newCustomerRef);
    // Then update state to trigger provider re-render with new customerRef
    // This will cause subscriptions to refetch automatically
    setCustomerId(newCustomerRef);
  }, []); // Empty deps - callback doesn't need to change

  const handleCreatePayment = useCallback(async ({ planRef, customerRef }: { planRef: string; customerRef: string }) => {
    const res = await fetch('/api/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planRef, customerRef, agentRef: process.env.NEXT_PUBLIC_AGENT_REF || 'demo_agent' }),
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.details || errorData.error || 'Failed to create payment intent';
      throw new Error(errorMessage);
    }
    
    return res.json();
  }, []);

  const handleCheckSubscription = useCallback(async (customerRef: string) => {
    const res = await fetch(`/api/check-subscription?customerRef=${customerRef}`);
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.error || 'Failed to check subscription';
      throw new Error(errorMessage);
    }
    
    return res.json();
  }, []);

  return (
    <html lang="en">
      <head>
        <title>SolvaPay Checkout Demo</title>
        <meta name="description" content="Minimal subscription checkout" />
      </head>
      <body className="font-sans">
        {customerId ? (
          <SolvaPayProvider
            customerRef={customerId}
            onCustomerRefUpdate={handleCustomerRefUpdate}
            createPayment={handleCreatePayment}
            checkSubscription={handleCheckSubscription}
          >
            {children}
          </SolvaPayProvider>
        ) : (
          // Show loading state while customer ID is being initialized
          <div className="flex justify-center items-center min-h-screen text-slate-500">
            Initializing...
          </div>
        )}
      </body>
    </html>
  );
}
