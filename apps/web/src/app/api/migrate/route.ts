import { resolve } from 'node:path';

import { type NextRequest, NextResponse } from 'next/server';

import { migrateDatabase } from '@uar/api';

/**
 * POST /api/migrate — runs Drizzle migrations.
 *
 * Protected by MIGRATE_SECRET env var. Called automatically by Vercel's
 * post-deploy hook (vercel.json → deploymentExpressSettings.postDeploy).
 * Can also be triggered manually: curl -XPOST -H "x-migrate-secret: $SECRET" /api/migrate
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.MIGRATE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'MIGRATE_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('x-migrate-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // migrationsFolder is relative to apps/api — resolve from this file's location
    const migrationsFolder = resolve(process.cwd(), '../../apps/api/drizzle');
    await migrateDatabase({ migrationsFolder });
    return NextResponse.json({ ok: true, migrationsFolder });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[migrate] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
