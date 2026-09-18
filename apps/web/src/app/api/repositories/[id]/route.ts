import { NextResponse } from 'next/server';

import { requireUser, toPublicError } from '@archaeologist/api';

import { createRepositoryService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUser(getSessionUser);
    const repository = await createRepositoryService().get(user, id);
    return NextResponse.json({ repository });
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUser(getSessionUser);
    await createRepositoryService().delete(user, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
