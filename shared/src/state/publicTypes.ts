import type { Stroke } from './drawingTypes.js';

export type RoomMode = 'NORMAL' | 'MODERATOR';
export type AnswerMode = 'FIRST_CORRECT' | 'UNTIL_TIMER';
export type DrawerOrderMode = 'FIXED' | 'ROTATE';
/** 제시어를 어느 풀에서 뽑을지. 단어는 기본 목록, 속담은 별도 목록. */
export type KeywordSource = 'WORD' | 'PROVERB';
/** 속담 풀을 난이도로 좁힌다. ALL이면 전체에서 뽑는다. */
export type ProverbDifficulty = 'ALL' | 'EASY' | 'NORMAL' | 'HARD';
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
  keywordSource: KeywordSource;
  proverbDifficulty: ProverbDifficulty;
  /** 진행자가 다음 제시어를 잠갔는지. 잠기면 그리기 담당자가 바꿀 수 없다. */
  keywordLocked: boolean;
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
