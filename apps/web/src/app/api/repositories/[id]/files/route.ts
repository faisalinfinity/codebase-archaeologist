import { NextResponse } from 'next/server';

import { requireUser, toPublicError } from '@archaeologist/api';

import { createRepositoryService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUser(getSessionUser);
    const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
    const result = await createRepositoryService().listIndexedFiles(user, id, page);
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
