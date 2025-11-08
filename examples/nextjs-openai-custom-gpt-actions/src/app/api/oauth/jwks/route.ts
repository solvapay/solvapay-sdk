import { NextResponse } from 'next/server';

export async function GET() {
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
