import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';

export async function POST(request: NextRequest) {
  try {
    const userIdOrError = requireUserId(request);
    if (userIdOrError instanceof Response) {
      return userIdOrError;
    }
    const userId = userIdOrError;

    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    const { planRef, agentRef } = await request.json();

    if (!agentRef) {
      return NextResponse.json(
        { error: 'Missing required parameter: agentRef is required' },
        { status: 400 }
      );
    }

    const solvaPay = createSolvaPay();

    const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    const session = await solvaPay.createCheckoutSession({
      agentRef,
      customerRef: ensuredCustomerRef,
      planRef: planRef || undefined,
    });

    return NextResponse.json({
      sessionId: session.sessionId,
      checkoutUrl: session.checkoutUrl,
    });

  } catch (error) {
    console.error('Checkout session creation failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Checkout session creation failed', details: errorMessage },
      { status: 500 }
    );
  }
}

