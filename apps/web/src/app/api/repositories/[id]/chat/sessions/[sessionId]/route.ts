import { NextResponse } from 'next/server';

import { requireUser, toPublicError } from '@archaeologist/api';

import { createChatService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string; sessionId: string }>;
  },
) {
  try {
    const { id, sessionId } = await context.params;
    const user = await requireUser(getSessionUser);
    return NextResponse.json(await createChatService().getSession(user, id, sessionId));
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
