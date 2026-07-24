import type { AllowedAction } from '../../../shared/src/index.js';
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
  const privileged = player.isHost || player.isModerator;
  const isDrawer = player.playerId === room.drawerId;

  if (preparing && privileged) {
    actions.push('SET_ROUND_DURATION', 'SET_ANSWER_MODE');
  }
  if (preparing && isDrawer && canStartRound(room)) actions.push('SET_KEYWORD_AND_START');

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

  const canManageDrawer = preparing
    ? privileged
    : active && room.mode === 'MODERATOR' && player.isModerator;
  if (canManageDrawer) {
    const hasAssignablePlayer = [...room.players.values()].some((target) =>
      target.connected &&
      !target.isModerator &&
      target.playerId !== room.drawerId &&
      (preparing || !target.isHost)
    );
    if (hasAssignablePlayer) actions.push('ASSIGN_DRAWER');
    if (room.drawerId !== player.playerId) actions.push('RECLAIM_DRAWER');
  }

  if (privileged && [...room.players.values()].some((target) =>
    target.playerId !== player.playerId && !target.isHost && !target.isModerator
  )) {
    actions.push('KICK_PLAYER');
  }

  if ((room.round.status === 'SOLVED' || room.round.status === 'EXPIRED') &&
      ((room.mode === 'NORMAL' && player.isHost) ||
       (room.mode === 'MODERATOR' && player.isModerator))) {
    actions.push('START_NEXT_ROUND');
  }
  if ((active || room.round.status === 'SOLVED' || room.round.status === 'EXPIRED') && privileged) {
    actions.push('RETURN_TO_WAITING');
  }
  return actions;
};
