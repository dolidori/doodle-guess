import {
  MAX_DRAWING_BYTES,
  MAX_POINTS_PER_DRAWING,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES_PER_DRAWING,
  type StrokeBatchPayload
} from '../../../shared/src/index.js';
import { ProtocolError, assertProtocol } from '../protocol/errors.js';
import type { DrawingState, RoomRuntime } from '../rooms/types.js';

export const assertDrawingIdentity = (
  room: RoomRuntime,
  payload: Pick<StrokeBatchPayload, 'drawingRevision' | 'drawerEpoch'>
): void => {
  assertProtocol(
    payload.drawingRevision === room.round.drawing.drawingRevision,
    'STALE_DRAWING_REVISION',
    '이전 캔버스의 요청입니다.',
    {
      expected: room.round.drawing.drawingRevision,
      received: payload.drawingRevision,
      drawingRevision: room.round.drawing.drawingRevision
    }
  );
  assertProtocol(
    payload.drawerEpoch === room.round.drawing.drawerEpoch,
    'STALE_DRAWER_EPOCH',
    '이전 그리기 권한의 요청입니다.',
    {
      expected: room.round.drawing.drawerEpoch,
      received: payload.drawerEpoch,
      drawerEpoch: room.round.drawing.drawerEpoch
    }
  );
};

export const assertDrawingCapacity = (
  drawing: DrawingState,
  addedPoints: number,
  addedBytes: number,
  createsStroke: boolean
): void => {
  if (createsStroke && drawing.strokeCount >= MAX_STROKES_PER_DRAWING) {
    throw new ProtocolError('DRAWING_LIMIT', '스트로크 수 제한에 도달했습니다.');
  }
  if (drawing.pointCount + addedPoints > MAX_POINTS_PER_DRAWING ||
      drawing.serializedBytes + addedBytes > MAX_DRAWING_BYTES) {
    throw new ProtocolError('DRAWING_LIMIT', '캔버스 데이터 제한에 도달했습니다.');
  }
};

export const assertStrokeCapacity = (currentPoints: number, addedPoints: number): void => {
  assertProtocol(
    currentPoints + addedPoints <= MAX_POINTS_PER_STROKE,
    'STROKE_LIMIT',
    '하나의 스트로크는 2,048점을 넘을 수 없습니다.'
  );
};
