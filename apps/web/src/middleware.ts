import { type NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@descope/nextjs-sdk/server';

// When STUB_AUTHZ is true (dev/e2e), bypass all auth checks.
// The API Route Handlers handle stub auth independently.
const stubMiddleware = () => NextResponse.next();

const descopeMiddleware = authMiddleware({
  projectId: process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID ?? '',
  redirectUrl: '/login',
  publicRoutes: ['/login', '/api/health', '/api/migrate'],
});

export default function middleware(req: NextRequest) {
  if (process.env.STUB_AUTHZ === 'true') return stubMiddleware();
  return descopeMiddleware(req);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*[.](?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
