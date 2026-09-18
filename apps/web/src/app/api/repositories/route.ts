import { NextResponse } from 'next/server';

import { requireUser, toPublicError, ValidationError } from '@archaeologist/api';

import { createRepositoryService } from '@/lib/services';
import { createRepositoryWriteService } from '@/lib/services-write';
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
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      throw new ValidationError('Invalid JSON body.');
    }
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
