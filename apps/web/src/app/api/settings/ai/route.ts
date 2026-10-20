import { NextResponse } from 'next/server';
import { requireUser, toPublicError, readJsonRequest, assertSameOrigin } from '@archaeologist/api';
import { createProviderSettingsService } from '@/lib/services';
import { enforceRequestLimit } from '@/lib/request-limit';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await requireUser(getSessionUser);
    return NextResponse.json(await createProviderSettingsService().get(user.id), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser(getSessionUser);
    assertSameOrigin(request, process.env.NEXT_PUBLIC_APP_URL);
    await enforceRequestLimit(user.id, 'provider-settings', 'MAX_PROVIDER_SETTINGS_PER_HOUR', 30);
    await createProviderSettingsService().save(user, await readJsonRequest(request));
    return NextResponse.json({ saved: true });
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(getSessionUser);
    assertSameOrigin(request, process.env.NEXT_PUBLIC_APP_URL);
    await createProviderSettingsService().delete(user.id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
