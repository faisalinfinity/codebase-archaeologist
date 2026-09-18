import type { ErrorCode } from '@archaeologist/shared';

export class IngestionError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
  }
}
