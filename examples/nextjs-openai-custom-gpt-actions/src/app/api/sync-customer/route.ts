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

    const solvaPay = createSolvaPay();

    const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    return NextResponse.json({
      success: true,
      customerRef: ensuredCustomerRef,
    });

  } catch (error) {
    console.error('Customer sync failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Customer sync failed', details: errorMessage },
      { status: 500 }
    );
  }
}

