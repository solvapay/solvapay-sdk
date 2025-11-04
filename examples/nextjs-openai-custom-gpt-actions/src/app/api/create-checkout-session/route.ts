import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const { planRef, agentRef } = await request.json();

  if (!agentRef) {
    return NextResponse.json(
      { error: 'Missing required parameter: agentRef is required' },
      { status: 400 }
    );
  }

  const result = await createCheckoutSession(request, { agentRef, planRef });
  return result instanceof NextResponse ? result : NextResponse.json(result);
}

