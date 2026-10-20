import { NextResponse } from 'next/server';

import { requireUser, toPublicError, assertSameOrigin } from '@archaeologist/api';

import { createRepositoryWriteService } from '@/lib/services-write';
import { enforceRequestLimit } from '@/lib/request-limit';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUser(getSessionUser);
    assertSameOrigin(request, process.env.NEXT_PUBLIC_APP_URL);
    await enforceRequestLimit(user.id, 'repository-index', 'MAX_INDEX_REQUESTS_PER_HOUR', 10);
    const status = await (await createRepositoryWriteService()).startIndex(user, id);
    return NextResponse.json(status);
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
