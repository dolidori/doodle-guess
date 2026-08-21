import type { ALLOWED_ACTIONS } from '../protocol/constants.js';

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

export type PrivateState = {
  playerId: string;
  roundId: string;
  keyword: string | null;
  suggestedKeyword: string | null;
  hasSeenKeywordThisRound: boolean;
  hasAnsweredCorrectly: boolean;
  /** 이번 라운드에 제시어를 다시 뽑을 수 있는 남은 횟수. */
  remainingKeywordShuffles: number;
  allowedActions: AllowedAction[];
};

export type RoomSession = {
  roomCode: string;
  playerId: string;
  nickname: string;
  mode: 'NORMAL' | 'MODERATOR';
  sessionToken: string;
  isReconnect: boolean;
};
