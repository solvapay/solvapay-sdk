'use client';

import { SolvaPayProvider } from '@solvapay/react';
import { useState, useEffect, useCallback } from 'react';
import { getUserId, getAccessToken, onAuthStateChange } from '@/lib/supabase';
import { Auth } from './components/Auth';
import { Inter } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [customerId, setCustomerId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  // Initialize customer ID from Supabase session
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const userId = await getUserId();
        setCustomerId(userId || '');
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
    const { data: { subscription } } = onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setCustomerId(session?.user?.id || '');
      } else if (event === 'SIGNED_OUT') {
        setCustomerId('');
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  // Memoize callback functions to prevent unnecessary re-renders
  const handleCustomerRefUpdate = useCallback((newCustomerRef: string) => {
    setCustomerId(newCustomerRef);
  }, []);

  // Dummy createPayment function for hosted checkout
  const handleCreatePayment = useCallback(async ({ planRef, customerRef }: { planRef: string; customerRef: string }) => {
    throw new Error('Hosted checkout: Use redirect to app.solvapay.com/checkout instead of createPayment');
  }, []);

  const handleCheckSubscription = useCallback(async (customerRef: string) => {
    const accessToken = await getAccessToken();
    
    const headers: HeadersInit = {};
    
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

  return (
    <html lang="en">
      <head>
        <title>SolvaPay Custom GPT Actions Demo</title>
        <meta name="description" content="Next.js frontend for SolvaPay Custom GPT Actions API" />
      </head>
      <body className={inter.className}>
        {isLoading ? (
          <div className="flex justify-center items-center min-h-screen text-gray-500">
            Initializing...
          </div>
        ) : customerId ? (
          <SolvaPayProvider
            customerRef={customerId}
            onCustomerRefUpdate={handleCustomerRefUpdate}
            createPayment={handleCreatePayment}
            checkSubscription={handleCheckSubscription}
          >
            <div className="min-h-screen bg-gray-50">
              <nav className="bg-white shadow-sm border-b">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="flex justify-between h-16">
                    <div className="flex items-center">
                      <h1 className="text-xl font-semibold text-gray-900">
                        SolvaPay Custom GPT Actions
                      </h1>
                    </div>
                    <div className="flex items-center space-x-4">
                      <Link href="/" className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                        Home
                      </Link>
                      <Link href="/oauth/authorize" className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                        OAuth Login
                      </Link>
                      <Link href="/checkout" className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                        Checkout
                      </Link>
                      <Link href="/docs" className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                        API Docs
                      </Link>
                    </div>
                  </div>
                </div>
              </nav>
              <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                {children}
              </main>
            </div>
          </SolvaPayProvider>
        ) : (
          <Auth />
        )}
      </body>
    </html>
  )
}
