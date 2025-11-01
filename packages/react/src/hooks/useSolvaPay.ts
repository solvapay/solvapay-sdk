import { useContext } from 'react';
import { SolvaPayContext } from '../SolvaPayProvider';
import type { SolvaPayContextValue } from '../types';

/**
 * Hook to access SolvaPay context
 * Must be used within a SolvaPayProvider
 */
export function useSolvaPay(): SolvaPayContextValue {
  const context = useContext(SolvaPayContext);
  
  if (!context) {
    throw new Error(
      'useSolvaPay must be used within a SolvaPayProvider. ' +
      'Wrap your component tree with <SolvaPayProvider> to use this hook.'
    );
  }
  
  return context;
}

