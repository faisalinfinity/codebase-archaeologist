import { NextResponse } from 'next/server';

import { requireUser, toPublicError, readJsonRequest, assertSameOrigin } from '@archaeologist/api';

import { createRepositoryService } from '@/lib/services';
import { createRepositoryWriteService } from '@/lib/services-write';
import { enforceRequestLimit } from '@/lib/request-limit';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser(getSessionUser);
    const repositories = await createRepositoryService().list(user);
    return NextResponse.json({ repositories });
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(getSessionUser);
    assertSameOrigin(request, process.env.NEXT_PUBLIC_APP_URL);
    await enforceRequestLimit(user.id, 'repository-create', 'MAX_REPOSITORY_REQUESTS_PER_HOUR', 10);
    const json = await readJsonRequest(request);
    const result = await (await createRepositoryWriteService()).create(user, json);
    return NextResponse.json(
      { ...result.repository, alreadyExists: result.alreadyExists },
      { status: result.alreadyExists ? 200 : 201 },
    );
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
