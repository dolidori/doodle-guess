import { MAX_KEYWORD_SHUFFLES, type AllowedAction } from '../../../shared/src/index.js';
import type { Player, RoomRuntime } from '../rooms/types.js';

const isBeforeDeadline = (room: RoomRuntime, now: number): boolean =>
  room.round.roundEndsAt !== null && now < room.round.roundEndsAt;

export const canStartRound = (room: RoomRuntime): boolean => {
  const drawer = room.players.get(room.drawerId);
  if (!drawer?.connected) return false;
  return [...room.players.values()].some((player) =>
    player.connected &&
    !player.isModerator &&
    player.playerId !== room.drawerId &&
    !room.round.keywordExposedPlayerIds.has(player.playerId)
  );
};

export const allowedActionsFor = (
  room: RoomRuntime,
  player: Player,
  now = Date.now()
): AllowedAction[] => {
  if (!player.connected || room.status === 'CLOSED') return [];
  const actions: AllowedAction[] = ['LEAVE_ROOM'];
  const preparing = room.round.status === 'PREPARING_KEYWORD';
  const active = room.round.status === 'DRAWING_AND_GUESSING';
  const ended = room.round.status === 'SOLVED' || room.round.status === 'EXPIRED';
  const results = room.status === 'RESULTS';
  const privileged = player.isHost || player.isModerator;
  const isDrawer = player.playerId === room.drawerId;

  if (preparing && privileged) {
    actions.push('SET_ROUND_DURATION', 'SET_ANSWER_MODE');
    if (room.rotationPlayerIds.length === 0) actions.push('SET_DRAWER_ORDER');
  }
  if (preparing && isDrawer && canStartRound(room)) actions.push('SET_KEYWORD_AND_START');
  if (ended && !results && isDrawer && canStartRound(room)) actions.push('SET_KEYWORD_AND_START');
  if ((preparing || (ended && !results)) && isDrawer && canStartRound(room) &&
      room.lockedKeyword === null &&
      (room.round.shuffleCounts.get(player.playerId) ?? 0) < MAX_KEYWORD_SHUFFLES) {
    actions.push('SHUFFLE_KEYWORD');
  }
  // 제시어 잠금은 추측에 참여하지 않는 진행자만 쓸 수 있다.
  if ((preparing || (ended && !results)) && player.isModerator) {
    actions.push(room.lockedKeyword === null ? 'LOCK_KEYWORD' : 'UNLOCK_KEYWORD');
  }

  if (active && isBeforeDeadline(room, now) && !room.round.guessLocked &&
      !player.isModerator &&
      !room.round.keywordExposedPlayerIds.has(player.playerId) &&
      !room.round.correctPlayerIds.has(player.playerId)) {
    actions.push('SUBMIT_GUESS');
  }

  if (active && isBeforeDeadline(room, now) && !room.round.drawingLocked && isDrawer) {
    actions.push('DRAW_STROKE_BATCH');
    if (room.round.drawing.strokes.some((stroke) => stroke.finalized && !stroke.undone)) {
      actions.push('UNDO_LAST_STROKE');
    }
    actions.push('CLEAR_DRAWING');
  }

  // 라운드가 돌지 않는 준비·종료 구간에서는 방장·진행자가 담당자를 바꿀 수 있다.
  const betweenRounds = preparing || (ended && !results);
  const canManageDrawer = betweenRounds
    ? privileged
    : active && room.mode === 'MODERATOR' && player.isModerator;
  if (canManageDrawer) {
    const hasAssignablePlayer = [...room.players.values()].some((target) =>
      target.connected &&
      !target.isModerator &&
      target.playerId !== room.drawerId &&
      (betweenRounds || !target.isHost)
    );
    if (hasAssignablePlayer) actions.push('ASSIGN_DRAWER');
    if (room.drawerId !== player.playerId) actions.push('RECLAIM_DRAWER');
  }

  if (privileged && [...room.players.values()].some((target) =>
    target.playerId !== player.playerId && !target.isHost && !target.isModerator
  )) {
    actions.push('KICK_PLAYER');
  }

  if ((active || (ended && !results)) && privileged) {
    actions.push('RETURN_TO_WAITING');
  }
  if (results && privileged) actions.push('END_CEREMONY');
  return actions;
};
