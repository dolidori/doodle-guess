import type { ErrorCode, ErrorPayload } from '../../../shared/src/index.js';

const RETRYABLE = new Set<ErrorCode>([
  'RATE_LIMITED',
  'SERVER_BUSY',
  'INTERNAL_ERROR',
  'ROOM_FULL',
  'ROOM_CODE_EXHAUSTED',
  'MIN_PLAYERS',
  'STROKE_SEQUENCE_GAP',
  'TARGET_DISCONNECTED'
]);

export class ProtocolError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorPayload['details']
  ) {
    super(message);
    this.name = 'ProtocolError';
  }

  toPayload(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: RETRYABLE.has(this.code),
      ...(this.details ? { details: this.details } : {})
    };
  }
}

export function assertProtocol(
  condition: unknown,
  code: ErrorCode,
  message: string,
  details?: ErrorPayload['details']
): asserts condition {
  if (!condition) throw new ProtocolError(code, message, details);
}
