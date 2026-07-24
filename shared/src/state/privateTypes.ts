import type { ALLOWED_ACTIONS } from '../protocol/constants.js';

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

export type PrivateState = {
  playerId: string;
  roundId: string;
  keyword: string | null;
  suggestedKeyword: string | null;
  hasSeenKeywordThisRound: boolean;
  hasAnsweredCorrectly: boolean;
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
