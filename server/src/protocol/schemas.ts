import { z } from 'zod';
import {
  CLIENT_EVENT_TYPES,
  MAX_DURATION_SECONDS,
  MAX_POINTS_PER_BATCH,
  MIN_DURATION_SECONDS,
  PALETTE,
  PROTOCOL_VERSION,
  STROKE_WIDTHS
} from '../../../shared/src/index.js';

const utf8Bytes = (value: string) => Buffer.byteLength(value, 'utf8');
const codePoints = (value: string) => [...value].length;
const hasControl = (value: string) =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });

const boundedText = (
  label: string,
  maxCodePoints: number,
  maxBytes: number,
  trim: boolean
) =>
  z.string().superRefine((value, context) => {
    const checked = trim ? value.trim() : value;
    if (codePoints(checked) < 1 || codePoints(checked) > maxCodePoints) {
      context.addIssue({ code: 'custom', message: `${label} 길이가 올바르지 않습니다.` });
    }
    if (utf8Bytes(value) > maxBytes) {
      context.addIssue({ code: 'custom', message: `${label} 바이트 제한을 넘었습니다.` });
    }
    if (hasControl(value)) {
      context.addIssue({ code: 'custom', message: `${label}에 제어 문자를 사용할 수 없습니다.` });
    }
  });

export const nicknameSchema = boundedText('닉네임', 20, 80, true).transform((value) => value.trim());
export const keywordSchema = boundedText('제시어', 50, 256, false);
export const guessSchema = boundedText('추측', 80, 512, true).transform((value) => value.trim());
export const uuidSchema = z.uuid();
export const roomCodeSchema = z.string().regex(/^[1-9][0-9]{2}$/u);
export const sessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const emptySchema = z.object({}).strict();

const pointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1)
}).strict();

const paletteSchema = z.enum(Object.keys(PALETTE) as [keyof typeof PALETTE, ...(keyof typeof PALETTE)[]]);
const widthSchema = z.enum(Object.keys(STROKE_WIDTHS) as [keyof typeof STROKE_WIDTHS, ...(keyof typeof STROKE_WIDTHS)[]]);

const strokeBatchSchema = z.object({
  roundId: uuidSchema,
  drawingRevision: z.number().int().nonnegative(),
  drawerEpoch: z.number().int().nonnegative(),
  strokeId: uuidSchema,
  batchSeq: z.number().int().nonnegative(),
  isFinal: z.boolean(),
  tool: z.enum(['PEN', 'ERASER']),
  color: paletteSchema.nullable(),
  width: widthSchema,
  points: z.array(pointSchema).min(1).max(MAX_POINTS_PER_BATCH)
}).strict().superRefine((value, context) => {
  if (value.tool === 'PEN' && value.color === null) {
    context.addIssue({ code: 'custom', path: ['color'], message: '펜에는 팔레트 색상이 필요합니다.' });
  }
  if (value.tool === 'ERASER' && value.color !== null) {
    context.addIssue({ code: 'custom', path: ['color'], message: '지우개 색상은 null이어야 합니다.' });
  }
});

export const payloadSchemas = {
  CREATE_ROOM: z.object({ nickname: nicknameSchema, mode: z.enum(['NORMAL', 'MODERATOR']) }).strict(),
  JOIN_ROOM: z.object({
    roomCode: roomCodeSchema,
    nickname: nicknameSchema,
    sessionToken: sessionTokenSchema.optional()
  }).strict(),
  LEAVE_ROOM: emptySchema,
  SET_ROUND_DURATION: z.object({
    durationSeconds: z.number().int().min(MIN_DURATION_SECONDS).max(MAX_DURATION_SECONDS)
      .refine((value) => value % 5 === 0)
  }).strict(),
  SET_ANSWER_MODE: z.object({
    answerMode: z.enum(['FIRST_CORRECT', 'UNTIL_TIMER'])
  }).strict(),
  SET_DRAWER_ORDER: z.object({
    drawerOrderMode: z.enum(['FIXED', 'ROTATE']),
    rotationLaps: z.number().int().min(1).max(10)
  }).strict(),
  SHUFFLE_KEYWORD: emptySchema,
  SET_KEYWORD_AND_START: z.object({ roundId: uuidSchema, keyword: keywordSchema }).strict(),
  SUBMIT_GUESS: z.object({ roundId: uuidSchema, guessId: uuidSchema, text: guessSchema }).strict(),
  DRAW_STROKE_BATCH: strokeBatchSchema,
  UNDO_LAST_STROKE: z.object({
    roundId: uuidSchema,
    drawingRevision: z.number().int().nonnegative(),
    drawerEpoch: z.number().int().nonnegative()
  }).strict(),
  CLEAR_DRAWING: z.object({
    roundId: uuidSchema,
    drawingRevision: z.number().int().nonnegative(),
    drawerEpoch: z.number().int().nonnegative()
  }).strict(),
  ASSIGN_DRAWER: z.object({ targetPlayerId: uuidSchema }).strict(),
  RECLAIM_DRAWER: emptySchema,
  KICK_PLAYER: z.object({ targetPlayerId: uuidSchema }).strict(),
  START_NEXT_ROUND: z.object({ previousRoundId: uuidSchema }).strict(),
  RETURN_TO_WAITING: z.object({ roundId: uuidSchema }).strict(),
  END_CEREMONY: emptySchema
} satisfies Record<(typeof CLIENT_EVENT_TYPES)[number], z.ZodType>;

const envelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.enum(CLIENT_EVENT_TYPES),
  requestId: uuidSchema,
  payload: z.unknown()
}).strict();

export type ParsedCommand = {
  v: 1;
  type: (typeof CLIENT_EVENT_TYPES)[number];
  requestId: string;
  payload: unknown;
};

export class PayloadValidationError extends Error {
  constructor(public readonly zodError: z.ZodError) {
    super('Invalid payload');
  }
}

export const parseCommand = (input: unknown): ParsedCommand => {
  const envelope = envelopeSchema.parse(input);
  const schema = payloadSchemas[envelope.type];
  const payload = schema.safeParse(envelope.payload);
  if (!payload.success) throw new PayloadValidationError(payload.error);
  return { ...envelope, payload: payload.data };
};
