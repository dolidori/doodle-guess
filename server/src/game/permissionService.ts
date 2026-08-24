import {
  MAX_KEYWORD_SHUFFLES,
  ROOM_CAPACITY,
  type AllowedAction
} from '../../../shared/src/index.js';
import { getAiConfig, isAiAvailable } from '../ai/config.js';
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
      room.round.shuffleCount < MAX_KEYWORD_SHUFFLES) {
    actions.push('SHUFFLE_KEYWORD');
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

  if (ended && !results && room.drawerOrderMode === 'FIXED' &&
      ((room.mode === 'NORMAL' && player.isHost) ||
       (room.mode === 'MODERATOR' && player.isModerator))) {
    actions.push('START_NEXT_ROUND');
  }
  if ((active || (ended && !results)) && privileged) {
    actions.push('RETURN_TO_WAITING');
  }
  if (results && privileged) actions.push('END_CEREMONY');

  // AI 관리는 방 권한과 별개로 서버 설정이 갖춰져야 한다. 실제로 넣을 수 있는지는
  // 로비에서 비밀번호를 통과했는지까지 봐야 하지만, 그건 연결이 알고 있으므로
  // 여기서는 방 쪽 조건만 본다.
  if (privileged && !results && isAiAvailable(getAiConfig())) {
    if (room.players.size < ROOM_CAPACITY) actions.push('ADD_AI_PLAYER');
    if ([...room.players.values()].some((target) => target.isAI)) {
      actions.push('REMOVE_AI_PLAYER');
    }
  }
  return actions;
};
