import { type NextRequest, NextResponse } from 'next/server';

import {
  createDatabaseClient,
  createDescopeSessionVerifier,
  loadAuthzFlags,
  resolveTenantContextFromAuthorization,
} from '@uar/api';
import type { TenantContext } from '@uar/core';

export type RouteAuth = {
  readonly tenantContext: TenantContext;
  readonly db: ReturnType<typeof createDatabaseClient>['db'];
};

export async function authenticate(req: NextRequest): Promise<RouteAuth | NextResponse> {
  const flags = loadAuthzFlags(process.env as Record<string, string | undefined>);

  if (flags.stubAuthz) {
    const { db } = createDatabaseClient();
    return { tenantContext: flags.stubTenantContext, db };
  }

  const projectId = process.env.DESCOPE_PROJECT_ID;
  if (!projectId) {
    return NextResponse.json({ error: 'server_misconfigured', message: 'DESCOPE_PROJECT_ID not set' }, { status: 500 });
  }

  const verifier = createDescopeSessionVerifier({ projectId });
  try {
    const tenantContext = await resolveTenantContextFromAuthorization(
      req.headers.get('authorization') ?? undefined,
      verifier,
    );
    const { db } = createDatabaseClient();
    return { tenantContext, db };
  } catch {
    return NextResponse.json({ error: 'unauthenticated', message: 'Invalid or missing session' }, { status: 401 });
  }
}

export function notFound(error: string, message: string): NextResponse {
  return NextResponse.json({ error, message }, { status: 404 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: 'bad_request', message }, { status: 400 });
}

export function conflict(error: string, message: string): NextResponse {
  return NextResponse.json({ error, message }, { status: 409 });
}

export function requireUuid(value: string | undefined, name: string): string | NextResponse {
  if (!value || value.length === 0) {
    return notFound('not_found', `Missing route parameter ${name}`);
  }
  // basic UUID format check
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return notFound('not_found', `Route parameter ${name} was not found`);
  }
  return value;
}
