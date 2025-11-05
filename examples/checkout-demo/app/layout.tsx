'use client';

import { SolvaPayProvider } from '@solvapay/react';
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';
import { useState, useEffect, useMemo } from 'react';
import { getOrCreateCustomerId } from './lib/customer';
import { onAuthStateChange } from './lib/supabase';
import { Auth } from './components/Auth';
import { Navigation } from './components/Navigation';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize auth state and subscribe to changes
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const userId = await getOrCreateCustomerId();
        setIsAuthenticated(!!userId);
      } catch (error) {
        console.error('Failed to initialize auth:', error);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();

    // Subscribe to auth state changes
    const { data: { subscription } } = onAuthStateChange(async (event, session) => {
      // Update auth state when session changes
      const userId = session?.user?.id || null;
      setIsAuthenticated(!!userId);
    });

    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Create Supabase auth adapter (only if env vars are available)
  const supabaseAdapter = useMemo(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return undefined;
    }
    
    return createSupabaseAuthAdapter({
      supabaseUrl,
      supabaseAnonKey,
    });
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
        ) : isAuthenticated ? (
          // Provider with Supabase adapter (if available)
          <SolvaPayProvider config={supabaseAdapter ? { auth: { adapter: supabaseAdapter } } : undefined}>
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
