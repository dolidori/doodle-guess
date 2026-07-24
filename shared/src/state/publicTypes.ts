import type { Stroke } from './drawingTypes.js';

export type RoomMode = 'NORMAL' | 'MODERATOR';
export type AnswerMode = 'FIRST_CORRECT' | 'UNTIL_TIMER';
export type DrawerOrderMode = 'FIXED' | 'ROTATE';
export type RoomStatus =
  | 'WAITING'
  | 'ROUND_ACTIVE'
  | 'ROUND_SOLVED'
  | 'ROUND_EXPIRED'
  | 'RESULTS'
  | 'CLOSED';
export type RoundStatus = 'PREPARING_KEYWORD' | 'DRAWING_AND_GUESSING' | 'SOLVED' | 'EXPIRED';

export type PublicPlayer = {
  playerId: string;
  nickname: string;
  connected: boolean;
  isHost: boolean;
  isModerator: boolean;
  score: number;
};

export type FinalRanking = {
  rank: number;
  playerId: string;
  nickname: string;
  score: number;
};

export type GuessPublic = {
  guessId: string;
  roundId: string;
  guessSeq: number;
  playerId: string;
  nickname: string;
  text: string | null;
  submittedAt: number;
  isCorrect: boolean;
};

export type PublicRound = {
  roundId: string;
  roundNumber: number;
  status: RoundStatus;
  durationSeconds: number;
  startedAt: number | null;
  roundEndsAt: number | null;
  hasKeyword: boolean;
  guessLocked: boolean;
  drawingLocked: boolean;
  winnerId: string | null;
  winnerNickname: string | null;
  solvedAt: number | null;
  expiredAt: number | null;
  lastRoundEventId: string | null;
  guessSeq: number;
  correctCount: number;
};

export type PublicState = {
  roomCode: string;
  mode: RoomMode;
  answerMode: AnswerMode;
  drawerOrderMode: DrawerOrderMode;
  rotationLaps: number;
  rotationCurrentTurn: number;
  rotationTotalTurns: number;
  finalRankings: FinalRanking[] | null;
  status: RoomStatus;
  roomVersion: number;
  eventSeq: number;
  serverNow: number;
  hostDisconnectedAt: number | null;
  expiresAt: number | null;
  players: PublicPlayer[];
  drawerId: string;
  drawerEpoch: number;
  round: PublicRound;
  drawing: {
    drawingRevision: number;
    drawingSeq: number;
    strokeCount: number;
    pointCount: number;
  };
  guessFeed: GuessPublic[];
};

export type AuthoritativeDrawing = {
  roundId: string | null;
  drawingRevision: number;
  drawingSeq: number;
  strokes: Stroke[];
};
