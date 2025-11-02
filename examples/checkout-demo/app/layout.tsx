'use client';

import { SolvaPayProvider } from '@solvapay/react';
import { useState, useEffect, useCallback } from 'react';
import { getOrCreateCustomerId, updateCustomerId } from './lib/customer';
import { getAccessToken, onAuthStateChange } from './lib/supabase';
import { Auth } from './components/Auth';
import { Navigation } from './components/Navigation';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [customerId, setCustomerId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  // Initialize customer ID from Supabase session
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const userId = await getOrCreateCustomerId();
        setCustomerId(userId);
      } catch (error) {
        console.error('Failed to initialize auth:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  // Listen for auth state changes (sign in/out)
  useEffect(() => {
    const authStateChange = onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const userId = session?.user?.id || '';
        // Only update if userId actually changed to prevent unnecessary re-renders
        setCustomerId(prev => prev !== userId ? userId : prev);
      } else if (event === 'SIGNED_OUT') {
        setCustomerId('');
      }
    });

    return () => {
      if (authStateChange?.data?.subscription) {
        authStateChange.data.subscription.unsubscribe();
      }
    };
  }, []);

  // Memoize callback functions to prevent unnecessary re-renders
  const handleCustomerRefUpdate = useCallback((newCustomerRef: string) => {
    // Update state to trigger provider re-render with new customerRef
    // This will cause subscriptions to refetch automatically
    setCustomerId(newCustomerRef);
    // Note: updateCustomerId is a no-op for Supabase auth
    updateCustomerId(newCustomerRef);
  }, []); // Empty deps - callback doesn't need to change

  const handleCreatePayment = useCallback(async ({ planRef, customerRef }: { planRef: string; customerRef: string }) => {
    const accessToken = await getAccessToken();
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    // Add Authorization header if we have an access token
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const res = await fetch('/api/create-payment-intent', {
      method: 'POST',
      headers,
      body: JSON.stringify({ planRef, agentRef: process.env.NEXT_PUBLIC_AGENT_REF || 'demo_agent' }),
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.details || errorData.error || 'Failed to create payment intent';
      throw new Error(errorMessage);
    }
    
    return res.json();
  }, []);

  const handleCheckSubscription = useCallback(async (customerRef: string) => {
    const accessToken = await getAccessToken();
    
    const headers: HeadersInit = {};
    
    // Add Authorization header if we have an access token
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const res = await fetch('/api/check-subscription', {
      headers,
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.error || 'Failed to check subscription';
      throw new Error(errorMessage);
    }
    
    return res.json();
  }, []);

  const handleProcessPayment = useCallback(async (params: {
    paymentIntentId: string;
    agentRef: string;
    customerRef: string;
    planRef?: string;
  }) => {
    const accessToken = await getAccessToken();
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
    };

    const res = await fetch('/api/process-payment', {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to process payment');
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
        {isLoading ? (
          // Show loading state while auth is being initialized
          <div className="flex justify-center items-center min-h-screen text-slate-500">
            Initializing...
          </div>
        ) : customerId ? (
          <SolvaPayProvider
            customerRef={customerId}
            onCustomerRefUpdate={handleCustomerRefUpdate}
            createPayment={handleCreatePayment}
            checkSubscription={handleCheckSubscription}
            processPayment={handleProcessPayment}
          >
            <Navigation />
            {children}
          </SolvaPayProvider>
        ) : (
          // Show auth form if not authenticated
          <Auth />
        )}
      </body>
    </html>
  );
}
