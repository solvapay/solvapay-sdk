import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription, type SubscriptionCheckResult } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  
  if (result instanceof NextResponse) {
    return result;
  }
  
  const subscriptionData = result as SubscriptionCheckResult;
  
  return NextResponse.json(subscriptionData);
}

