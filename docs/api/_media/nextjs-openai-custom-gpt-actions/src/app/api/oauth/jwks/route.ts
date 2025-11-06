import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  return NextResponse.json({
    keys: [
      {
        kty: 'oct',
        kid: 'demo-key',
        use: 'sig',
        alg: 'HS256'
      }
    ]
  });
}
