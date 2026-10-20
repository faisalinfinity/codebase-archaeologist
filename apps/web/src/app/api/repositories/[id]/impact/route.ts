import { NextResponse } from 'next/server';

import { requireUser, toPublicError } from '@archaeologist/api';

import { createRepositoryService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUser(getSessionUser);
    const filePath = new URL(request.url).searchParams.get('path') ?? '';
    return NextResponse.json(
      await createRepositoryService().getImpact(
        user,
        id,
        filePath,
        new URL(request.url).searchParams.get('symbol') ?? undefined,
      ),
    );
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
