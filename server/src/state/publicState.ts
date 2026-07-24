import type { PublicState } from '../../../shared/src/index.js';
import type { RoomRuntime } from '../rooms/types.js';

export const buildPublicState = (room: RoomRuntime, now = Date.now()): PublicState => ({
  roomCode: room.roomCode,
  mode: room.mode,
  answerMode: room.answerMode,
  status: room.status,
  roomVersion: room.roomVersion,
  eventSeq: room.eventSeq,
  serverNow: now,
  hostDisconnectedAt: room.hostDisconnectedAt,
  expiresAt: room.expiresAt,
  players: [...room.players.values()].map((player) => ({
    playerId: player.playerId,
    nickname: player.nickname,
    connected: player.connected,
    isHost: player.isHost,
    isModerator: player.isModerator,
    score: player.score
  })),
  drawerId: room.drawerId,
  drawerEpoch: room.round.drawing.drawerEpoch,
  round: {
    roundId: room.round.roundId,
    roundNumber: room.round.roundNumber,
    status: room.round.status,
    durationSeconds: room.durationSeconds,
    startedAt: room.round.startedAt,
    roundEndsAt: room.round.roundEndsAt,
    hasKeyword: room.round.hasKeyword,
    guessLocked: room.round.guessLocked,
    drawingLocked: room.round.drawingLocked,
    winnerId: room.round.winnerId,
    winnerNickname: room.round.winnerNickname,
    solvedAt: room.round.solvedAt,
    expiredAt: room.round.expiredAt,
    lastRoundEventId: room.round.lastRoundEventId,
    guessSeq: room.round.guessSeq,
    correctCount: room.round.correctPlayerIds.size
  },
  drawing: {
    drawingRevision: room.round.drawing.drawingRevision,
    drawingSeq: room.round.drawing.drawingSeq,
    strokeCount: room.round.drawing.strokeCount,
    pointCount: room.round.drawing.pointCount
  },
  guessFeed: room.guessFeed
});
