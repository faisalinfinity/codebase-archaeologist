import { HttpError, ValidationError } from '../errors';

export function assertSameOrigin(request: Request, appUrl?: string): void {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(appUrl ?? request.url).origin)
    throw new HttpError(403, 'invalid_origin', 'Request origin is not allowed.');
}

export async function readJsonRequest(request: Request, maxBytes = 16_384): Promise<unknown> {
  if (!request.body) throw new ValidationError('A JSON body is required.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw new HttpError(413, 'body_too_large', 'Request body is too large.');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ValidationError('Invalid JSON body.');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
