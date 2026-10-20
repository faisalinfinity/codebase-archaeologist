import { NextResponse } from 'next/server';

import {
  requireUser,
  toPublicError,
  readJsonRequest,
  assertSameOrigin,
  publicChatFailure,
} from '@archaeologist/api';

import { createChatService } from '@/lib/services';
import { enforceRequestLimit } from '@/lib/request-limit';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

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
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': connected\n\n'));
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
          } catch {
            clearInterval(heartbeat);
            abort.abort();
          }
        }, 15_000);
        void (async () => {
          try {
            for await (const event of prepared.stream()) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
          } catch (error) {
            const failure = publicChatFailure(error);
            if (!signal.aborted)
              console.error(
                JSON.stringify({
                  msg: 'chat_stream_failed',
                  code: failure.code,
                  ...('provider' in failure
                    ? { provider: failure.provider, upstreamStatus: failure.upstreamStatus }
                    : {}),
                }),
              );
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'error', code: failure.code, message: failure.message })}\n\n`,
                ),
              );
            } catch {
              /* Client disconnected. */
            }
          } finally {
            clearInterval(heartbeat);
            try {
              controller.close();
            } catch {
              /* Client disconnected. */
            }
          }
        })();
      },
      cancel() {
        clearInterval(heartbeat);
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
