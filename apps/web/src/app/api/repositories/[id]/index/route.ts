import { NextResponse } from 'next/server';

import { requireUser, toPublicError } from '@archaeologist/api';

import { createRepositoryWriteService } from '@/lib/services-write';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUser(getSessionUser);
    const status = await (await createRepositoryWriteService()).startIndex(user, id);
    return NextResponse.json(status);
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
