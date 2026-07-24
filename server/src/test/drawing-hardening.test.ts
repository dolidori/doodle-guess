import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import {
  FAILED_CONNECTION_BYTES,
  MAX_DRAWING_BYTES,
  MAX_POINTS_PER_DRAWING,
  MAX_SNAPSHOT_CHUNK_BYTES,
  MAX_STROKES_PER_DRAWING,
  RECOVERED_CONNECTION_BYTES,
  SLOW_CONNECTION_BYTES,
  type StrokeBatchPayload
} from '../../../shared/src/index.js';
import { canSendDrawingDelta, isRecovered } from '../broadcast/backpressure.js';
import { broadcast, envelope } from '../broadcast/roomBroadcast.js';
import { DrawingService } from '../drawing/drawingService.js';
import { sendDrawingSnapshot } from '../drawing/snapshotService.js';
import {
  assertDrawingCapacity,
  assertStrokeCapacity
} from '../drawing/strokeValidation.js';
import { GameService } from '../game/gameService.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import {
  createPlayer,
  generateSessionToken,
  hashSessionToken,
  RoomService
} from '../rooms/roomService.js';
import type { ClientConnection, RoomRuntime } from '../rooms/types.js';

const fakeConnection = (id: string, bufferedAmount = 0): ClientConnection => ({
  id,
  ws: {
    readyState: WebSocket.OPEN,
    bufferedAmount,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn()
  } as unknown as WebSocket,
  ip: `test-${id}`,
  roomCode: null,
  playerId: null,
  lastPongAt: Date.now(),
  needsSnapshot: false,
  overloadedSince: null,
  processedRequestIds: new Map(),
  explicitlyLeft: false
});

const setupActiveRoom = () => {
  const registry = new RoomRegistry();
  const roomService = new RoomService(registry);
  const gameService = new GameService(registry, roomService);
  const drawingService = new DrawingService(gameService, roomService);
  const token = generateSessionToken();
  const host = createPlayer('화가', hashSessionToken(token), true, false);
  const room = registry.create('NORMAL', host);
  const hostConnection = fakeConnection('host');
  hostConnection.roomCode = room.roomCode;
  hostConnection.playerId = host.playerId;
  room.connections.set(host.playerId, hostConnection);
  const guestToken = generateSessionToken();
  const guest = createPlayer('관찰자', hashSessionToken(guestToken), false, false);
  const guestConnection = fakeConnection('guest');
  guestConnection.roomCode = room.roomCode;
  guestConnection.playerId = guest.playerId;
  room.players.set(guest.playerId, guest);
  room.connections.set(guest.playerId, guestConnection);
  gameService.startRound(room, host.playerId, room.round.roundId, '선');
  return {
    room,
    host,
    hostConnection,
    guestConnection,
    drawingService
  };
};

const batchFor = (
  room: RoomRuntime,
  overrides: Partial<StrokeBatchPayload> = {}
): StrokeBatchPayload => ({
  roundId: room.round.roundId,
  drawingRevision: room.round.drawing.drawingRevision,
  drawerEpoch: room.round.drawing.drawerEpoch,
  strokeId: crypto.randomUUID(),
  batchSeq: 0,
  isFinal: true,
  tool: 'PEN',
  color: 'BLACK',
  width: 'MEDIUM',
  points: [{ x: 0.1, y: 0.2 }],
  ...overrides
});

describe('그림 상한·순서·권한', () => {
  it('2,049번째 stroke 점과 drawing 전체 상한을 거부한다', () => {
    expect(() => assertStrokeCapacity(2048, 1))
      .toThrowError(expect.objectContaining({ code: 'STROKE_LIMIT' }));
    const { room } = setupActiveRoom();
    room.round.drawing.pointCount = MAX_POINTS_PER_DRAWING;
    expect(() => assertDrawingCapacity(room.round.drawing, 1, 1, false))
      .toThrowError(expect.objectContaining({ code: 'DRAWING_LIMIT' }));
    room.round.drawing.pointCount = 0;
    room.round.drawing.strokeCount = MAX_STROKES_PER_DRAWING;
    expect(() => assertDrawingCapacity(room.round.drawing, 1, 1, true))
      .toThrowError(expect.objectContaining({ code: 'DRAWING_LIMIT' }));
    room.round.drawing.strokeCount = 0;
    room.round.drawing.serializedBytes = MAX_DRAWING_BYTES;
    expect(() => assertDrawingCapacity(room.round.drawing, 1, 1, false))
      .toThrowError(expect.objectContaining({ code: 'DRAWING_LIMIT' }));
  });

  it('완료되지 않은 stroke는 undo하지 않고 완료된 마지막 stroke만 undo한다', () => {
    const { room, host, hostConnection, drawingService } = setupActiveRoom();
    const strokeId = crypto.randomUUID();
    drawingService.draw(room, host.playerId, batchFor(room, {
      strokeId,
      isFinal: false
    }), hostConnection);
    expect(() => drawingService.undo(room, host.playerId, {
      roundId: room.round.roundId,
      drawingRevision: room.round.drawing.drawingRevision,
      drawerEpoch: room.round.drawing.drawerEpoch
    })).toThrowError(expect.objectContaining({ code: 'NO_STROKE_TO_UNDO' }));

    drawingService.draw(room, host.playerId, batchFor(room, {
      strokeId,
      batchSeq: 1,
      isFinal: true
    }), hostConnection);
    drawingService.undo(room, host.playerId, {
      roundId: room.round.roundId,
      drawingRevision: room.round.drawing.drawingRevision,
      drawerEpoch: room.round.drawing.drawerEpoch
    });
    expect(room.round.drawing.strokes[0]?.undone).toBe(true);
  });

  it('batch gap은 snapshot을 보내고 이전 drawerEpoch packet은 거부한다', () => {
    const { room, host, hostConnection, drawingService } = setupActiveRoom();
    expect(() => drawingService.draw(room, host.playerId, batchFor(room, {
      batchSeq: 1
    }), hostConnection)).toThrowError(expect.objectContaining({ code: 'STROKE_SEQUENCE_GAP' }));
    const types = vi.mocked(hostConnection.ws.send).mock.calls.map(([raw]) =>
      (JSON.parse(String(raw)) as { type: string }).type
    );
    expect(types).toContain('DRAWING_SNAPSHOT');

    const staleEpoch = room.round.drawing.drawerEpoch;
    room.round.drawing.drawerEpoch += 1;
    expect(() => drawingService.draw(room, host.playerId, batchFor(room, {
      drawerEpoch: staleEpoch
    }), hostConnection)).toThrowError(expect.objectContaining({ code: 'STALE_DRAWER_EPOCH' }));
  });
});

describe('스냅샷·backpressure', () => {
  it('snapshot envelope은 청크당 64KiB를 넘지 않는다', () => {
    const { room, host, hostConnection } = setupActiveRoom();
    room.round.drawing.strokes = Array.from({ length: 40 }, (_, strokeIndex) => ({
      strokeId: crypto.randomUUID(),
      authorId: host.playerId,
      roundId: room.round.roundId,
      drawingRevision: 0,
      drawerEpoch: 0,
      tool: 'PEN' as const,
      color: 'BLACK' as const,
      width: 'MEDIUM' as const,
      points: Array.from({ length: 512 }, (_, pointIndex) => ({
        x: pointIndex / 512,
        y: strokeIndex / 40
      })),
      finalized: true,
      lastBatchSeq: 7,
      undone: false,
      createdAt: Date.now()
    }));
    vi.mocked(hostConnection.ws.send).mockClear();
    sendDrawingSnapshot(room, hostConnection);
    const messages = vi.mocked(hostConnection.ws.send).mock.calls.map(([raw]) => String(raw));
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) =>
      Buffer.byteLength(message, 'utf8') <= MAX_SNAPSHOT_CHUNK_BYTES
    )).toBe(true);
  });

  it('느린 연결만 delta를 건너뛰고 회복 시 snapshot 대상으로 표시한다', () => {
    const { room, hostConnection, guestConnection } = setupActiveRoom();
    Object.defineProperty(guestConnection.ws, 'bufferedAmount', {
      configurable: true,
      value: SLOW_CONNECTION_BYTES
    });
    vi.mocked(hostConnection.ws.send).mockClear();
    vi.mocked(guestConnection.ws.send).mockClear();
    broadcast(room, envelope('STROKE_BATCH', { test: true }), true);
    expect(hostConnection.ws.send).toHaveBeenCalledOnce();
    expect(guestConnection.ws.send).not.toHaveBeenCalled();
    expect(guestConnection.needsSnapshot).toBe(true);

    Object.defineProperty(guestConnection.ws, 'bufferedAmount', {
      configurable: true,
      value: RECOVERED_CONNECTION_BYTES - 1
    });
    expect(isRecovered(guestConnection)).toBe(true);
  });

  it('1MiB 이상이 5초 지속되면 해당 연결을 1013으로 닫는다', () => {
    const connection = fakeConnection('overloaded', FAILED_CONNECTION_BYTES);
    expect(canSendDrawingDelta(connection, 1000)).toBe(false);
    expect(connection.ws.close).not.toHaveBeenCalled();
    expect(canSendDrawingDelta(connection, 6000)).toBe(false);
    expect(connection.ws.close).toHaveBeenCalledWith(1013, '연결이 너무 느립니다.');
  });
});
