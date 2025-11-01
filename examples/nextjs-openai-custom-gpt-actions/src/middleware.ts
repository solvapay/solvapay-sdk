import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rewrite OAuth routes to API routes
  if (pathname.startsWith('/oauth/')) {
    const newUrl = request.nextUrl.clone();
    newUrl.pathname = `/api${pathname}`;
    console.log('🔄 [MIDDLEWARE] Rewriting OAuth route:', pathname, '→', newUrl.pathname);
    return NextResponse.rewrite(newUrl);
  }

  // Handle CORS
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Add customer reference to request headers for API routes
  const userEmail = request.headers.get('x-dev-user-email') || 'dev@example.com';
  const defaultCustomerRef = `demo_${userEmail.replace('@', '_').replace(/\./g, '_')}`;
  const url = request.nextUrl;
  const customerRefFromQuery = url.searchParams.get('customer_ref')?.trim() || '';
  const customerRef = customerRefFromQuery || defaultCustomerRef;
  
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-customer-ref', customerRef);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ['/api/:path*', '/oauth/:path*'],
};
