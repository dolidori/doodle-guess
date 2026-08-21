import type WebSocket from 'ws';
import type {
  AnswerMode,
  DrawerOrderMode,
  FinalRanking,
  GuessPublic,
  RoomMode,
  RoomStatus,
  RoundStatus,
  Stroke
} from '../../../shared/src/index.js';
import type { RoomCommandQueue } from './roomCommandQueue.js';

export type Player = {
  playerId: string;
  nickname: string;
  normalizedNickname: string;
  sessionTokenHash: string;
  connected: boolean;
  isHost: boolean;
  isModerator: boolean;
  score: number;
  joinedAt: number;
  disconnectedAt: number | null;
};

export type DrawingState = {
  drawingRevision: number;
  drawingSeq: number;
  drawerEpoch: number;
  strokes: Stroke[];
  strokeCount: number;
  pointCount: number;
  serializedBytes: number;
  acceptedBatches: Map<string, unknown>;
};

export type RoundState = {
  roundId: string;
  roundNumber: number;
  status: RoundStatus;
  hasKeyword: boolean;
  keyword: string | null;
  normalizedKeyword: string | null;
  keywordExposedPlayerIds: Set<string>;
  correctPlayerIds: Set<string>;
  startedAt: number | null;
  roundEndsAt: number | null;
  winnerId: string | null;
  winnerNickname: string | null;
  solvedAt: number | null;
  expiredAt: number | null;
  lastRoundEventId: string | null;
  guessSeq: number;
  /** 이번 라운드에 제시어를 다시 뽑은 횟수. 라운드가 바뀌면 0으로 시작한다. */
  shuffleCount: number;
  guessLocked: boolean;
  drawingLocked: boolean;
  drawing: DrawingState;
};

export type ClientConnection = {
  id: string;
  ws: WebSocket;
  ip: string;
  roomCode: string | null;
  playerId: string | null;
  lastPongAt: number;
  needsSnapshot: boolean;
  overloadedSince: number | null;
  processedRequestIds: Map<string, number>;
  explicitlyLeft: boolean;
  /** 인계 요청 시 이 연결이 살아 있는지 확인하려고 ping을 보낸 시각. */
  livenessProbeAt: number | null;
};

export type RoomRuntime = {
  roomCode: string;
  mode: RoomMode;
  answerMode: AnswerMode;
  drawerOrderMode: DrawerOrderMode;
  rotationLaps: number;
  rotationPlayerIds: string[];
  rotationTurnIndex: number;
  suggestedKeyword: string;
  lastSuggestedKeyword: string | null;
  finalRankings: FinalRanking[] | null;
  status: RoomStatus;
  roomVersion: number;
  eventSeq: number;
  capacity: 30;
  hostId: string;
  moderatorId: string | null;
  drawerId: string;
  durationSeconds: number;
  players: Map<string, Player>;
  round: RoundState;
  guessFeed: GuessPublic[];
  kickedNicknames: Set<string>;
  kickedSessionTokenHashes: Set<string>;
  hostDisconnectedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
  connections: Map<string, ClientConnection>;
  queue: RoomCommandQueue;
  roundTimer: NodeJS.Timeout | null;
  hostTimer: NodeJS.Timeout | null;
};
