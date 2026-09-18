import { NextResponse } from 'next/server';

import { isAuthConfigured, isDatabaseConfigured } from '@/lib/env';

export function GET() {
  return NextResponse.json({
    ok: true,
    milestone: 1,
    authConfigured: isAuthConfigured(),
    databaseConfigured: isDatabaseConfigured(),
  });
}
