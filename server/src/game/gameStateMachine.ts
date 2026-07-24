import type { RoomRuntime } from '../rooms/types.js';
import { assertProtocol } from '../protocol/errors.js';

export const assertRound = (room: RoomRuntime, roundId: string): void => {
  assertProtocol(room.round.roundId === roundId, 'STALE_ROUND', '현재 라운드가 아닙니다.', {
    roundId: room.round.roundId
  });
};

export const assertPreparing = (room: RoomRuntime): void => {
  assertProtocol(
    room.status === 'WAITING' && room.round.status === 'PREPARING_KEYWORD',
    'INVALID_PHASE',
    '라운드 준비 상태에서만 할 수 있습니다.'
  );
};
