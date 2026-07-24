import type { RoomRuntime } from '../rooms/types.js';

export const cancelRoundTimer = (room: RoomRuntime): void => {
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = null;
};
