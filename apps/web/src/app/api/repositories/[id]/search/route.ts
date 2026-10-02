import { NextResponse } from 'next/server';

import { requireUser, toPublicError } from '@archaeologist/api';

import { createRepositoryService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUser(getSessionUser);
    const query = new URL(request.url).searchParams.get('q') ?? '';
    return NextResponse.json(await createRepositoryService().search(user, id, query));
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
