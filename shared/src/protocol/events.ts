import type {
  CLIENT_EVENT_TYPES,
  ERROR_CODES,
  SERVER_EVENT_TYPES
} from './constants.js';
import type { StrokeBatchPayload } from '../state/drawingTypes.js';
import type { AnswerMode, DrawerOrderMode, RoomMode } from '../state/publicTypes.js';

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ClientPayloadMap = {
  CREATE_ROOM: { nickname: string; mode: RoomMode };
  JOIN_ROOM: { roomCode: string; nickname: string; sessionToken?: string };
  LEAVE_ROOM: Record<string, never>;
  SET_ROUND_DURATION: { durationSeconds: number };
  SET_ANSWER_MODE: { answerMode: AnswerMode };
  SET_DRAWER_ORDER: { drawerOrderMode: DrawerOrderMode; rotationLaps: number };
  SHUFFLE_KEYWORD: Record<string, never>;
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
  END_CEREMONY: Record<string, never>;
  AI_LOGIN: { password: string };
  ADD_AI_PLAYER: { count: number };
  REMOVE_AI_PLAYER: { targetPlayerId: string };
};

export type AiSessionPayload = {
  /** 비밀번호가 맞았는지. 틀리면 false로만 알려 주고 이유는 나누지 않는다. */
  authorized: boolean;
  /** 서버에 API 키와 비밀번호가 모두 설정되어 AI를 쓸 수 있는 상태인지. */
  available: boolean;
  message: string;
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
