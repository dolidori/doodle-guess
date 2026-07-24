import type {
  CLIENT_EVENT_TYPES,
  ERROR_CODES,
  SERVER_EVENT_TYPES
} from './constants.js';
import type { StrokeBatchPayload } from '../state/drawingTypes.js';
import type { AnswerMode, RoomMode } from '../state/publicTypes.js';

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ClientPayloadMap = {
  CREATE_ROOM: { nickname: string; mode: RoomMode };
  JOIN_ROOM: { roomCode: string; nickname: string; sessionToken?: string };
  LEAVE_ROOM: Record<string, never>;
  SET_ROUND_DURATION: { durationSeconds: number };
  SET_ANSWER_MODE: { answerMode: AnswerMode };
  SET_KEYWORD_AND_START: { roundId: string; keyword: string };
  SUBMIT_GUESS: { roundId: string; guessId: string; text: string };
  DRAW_STROKE_BATCH: StrokeBatchPayload;
  UNDO_LAST_STROKE: { roundId: string; drawingRevision: number; drawerEpoch: number };
  CLEAR_DRAWING: { roundId: string; drawingRevision: number; drawerEpoch: number };
  ASSIGN_DRAWER: { targetPlayerId: string };
  RECLAIM_DRAWER: Record<string, never>;
  KICK_PLAYER: { targetPlayerId: string };
  START_NEXT_ROUND: { previousRoundId: string };
  RETURN_TO_WAITING: { roundId: string };
};

export type ClientEnvelope<T extends ClientEventType = ClientEventType> = {
  v: 1;
  type: T;
  requestId: string;
  payload: ClientPayloadMap[T];
};

export type ServerEnvelope<T extends ServerEventType = ServerEventType> = {
  v: 1;
  type: T;
  requestId?: string;
  roomVersion?: number;
  eventSeq?: number;
  roundId?: string;
  payload: unknown;
};

export type ErrorPayload = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: {
    expected?: number;
    received?: number;
    roundId?: string;
    drawingRevision?: number;
    drawerEpoch?: number;
  };
};
