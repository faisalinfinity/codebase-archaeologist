import { errorMessages, type ErrorCode } from '@archaeologist/shared';

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
  constructor(message = 'Resource not found.', code = 'not_found') {
    super(404, code, message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, code = 'conflict') {
    super(409, code, message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends HttpError {
  constructor(message: string, code = 'validation_error') {
    super(422, code, message);
    this.name = 'ValidationError';
  }
}

export class RateLimitedError extends HttpError {
  constructor(message: string, code = 'GITHUB_RATE_LIMITED') {
    super(429, code, message);
    this.name = 'RateLimitedError';
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(message: string, code = 'REPOSITORY_TOO_LARGE') {
    super(413, code, message);
    this.name = 'PayloadTooLargeError';
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message: string, code = 'REDIS_UNAVAILABLE') {
    super(503, code, message);
    this.name = 'ServiceUnavailableError';
  }
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_GITHUB_URL: 422,
  REPOSITORY_NOT_FOUND: 404,
  PRIVATE_REPOSITORY: 403,
  GITHUB_RATE_LIMITED: 429,
  REPOSITORY_TOO_LARGE: 413,
  UNSUPPORTED_REPOSITORY: 422,
  INDEX_FAILED: 500,
  INDEX_TIMEOUT: 504,
  REDIS_UNAVAILABLE: 503,
};

export function errorFromCode(code: ErrorCode, message?: string): HttpError {
  return new HttpError(STATUS_BY_CODE[code], code, message ?? errorMessages[code]);
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
