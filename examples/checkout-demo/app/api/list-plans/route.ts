import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPayClient } from '@solvapay/server';

/**
 * List Plans API Route
 * 
 * Retrieves available subscription plans from SolvaPay.
 * Returns all plans for the configured agent.
 * 
 * Flow:
 * 1. Client calls this API with agentRef query parameter
 * 2. This route calls SolvaPay SDK to get list of plans
 * 3. Returns plans array with details
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentRef = searchParams.get('agentRef');

    if (!agentRef) {
      return NextResponse.json(
        { error: 'Missing required parameter: agentRef' },
        { status: 400 }
      );
    }

    // SECURITY: Only use the secret key on the server
    const solvapaySecretKey = process.env.SOLVAPAY_SECRET_KEY;
    const solvapayApiBaseUrl = process.env.SOLVAPAY_API_BASE_URL;

    if (!solvapaySecretKey) {
      console.error('Missing SOLVAPAY_SECRET_KEY environment variable');
      return NextResponse.json(
        { error: 'Server configuration error: SolvaPay secret key not configured' },
        { status: 500 }
      );
    }

    // Create SolvaPay API client
    const apiClient = createSolvaPayClient({
      apiKey: solvapaySecretKey,
      apiBaseUrl: solvapayApiBaseUrl,
    });

    try {
      // Get list of plans for the agent
      if (!apiClient.listPlans) {
        return NextResponse.json(
          { error: 'List plans method not available' },
          { status: 500 }
        );
      }

      const plans = await apiClient.listPlans(agentRef);

      // Return plans array
      return NextResponse.json({
        plans: plans || [],
        agentRef,
      });

    } catch (error) {
      // Failed to fetch plans
      console.error(`Failed to fetch plans for agent ${agentRef}:`, error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      return NextResponse.json(
        { error: 'Failed to fetch plans', details: errorMessage },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('List plans failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Failed to list plans', details: errorMessage },
      { status: 500 }
    );
  }
}

