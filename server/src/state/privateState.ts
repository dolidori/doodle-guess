import type { PrivateState } from '../../../shared/src/index.js';
import { allowedActionsFor } from '../game/permissionService.js';
import type { Player, RoomRuntime } from '../rooms/types.js';

export const buildPrivateState = (
  room: RoomRuntime,
  player: Player,
  now = Date.now()
): PrivateState => {
  const maySeeKeyword = player.playerId === room.drawerId || player.isModerator;
  return {
    playerId: player.playerId,
    roundId: room.round.roundId,
    keyword: maySeeKeyword ? room.round.keyword : null,
    suggestedKeyword: maySeeKeyword ? room.suggestedKeyword : null,
    hasSeenKeywordThisRound: room.round.keywordExposedPlayerIds.has(player.playerId),
    hasAnsweredCorrectly: room.round.correctPlayerIds.has(player.playerId),
    allowedActions: allowedActionsFor(room, player, now)
  };
};
