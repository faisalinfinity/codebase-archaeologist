import { NextResponse } from 'next/server';

import { requireUser, toPublicError, readJsonRequest, assertSameOrigin } from '@archaeologist/api';

import { createChatService } from '@/lib/services';
import { enforceRequestLimit } from '@/lib/request-limit';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUser(getSessionUser);
    return NextResponse.json({ sessions: await createChatService().listSessions(user, id) });
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireUser(getSessionUser);
    assertSameOrigin(request, process.env.NEXT_PUBLIC_APP_URL);
    await enforceRequestLimit(user.id, 'repository-chat', 'MAX_CHAT_REQUESTS_PER_HOUR', 20);
    const body = await readJsonRequest(request);
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal]);
    const prepared = await createChatService().prepare(user, id, body, signal);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          try {
            for await (const event of prepared.stream()) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
          } catch {
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'error', message: 'AI answer failed. Please try again.' })}\n\n`,
                ),
              );
            } catch {
              /* Client disconnected. */
            }
          } finally {
            try {
              controller.close();
            } catch {
              /* Client disconnected. */
            }
          }
        })();
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
