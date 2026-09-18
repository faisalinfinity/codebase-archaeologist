export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Authentication required.') {
    super(401, 'unauthorized', message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'You do not have access to this resource.') {
    super(403, 'forbidden', message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Resource not found.') {
    super(404, 'not_found', message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, 'conflict', message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super(422, 'validation_error', message);
    this.name = 'ValidationError';
  }
}

export function toPublicError(error: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code },
    };
  }
  console.error('[api]', error instanceof Error ? error.message : 'unknown_error');
  return {
    status: 500,
    body: { error: 'Something went wrong. Please try again.', code: 'internal_error' },
  };
}
