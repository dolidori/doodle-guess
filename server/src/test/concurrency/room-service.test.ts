import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { RoomRegistry } from '../../rooms/roomRegistry.js';
import {
  createPlayer,
  generateSessionToken,
  hashSessionToken,
  RoomService
} from '../../rooms/roomService.js';
import type { ClientConnection } from '../../rooms/types.js';

const fakeConnection = (id: string): ClientConnection => ({
  id,
  ws: {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
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

describe('Room 큐 동시성과 호스트 수명', () => {
  it('29슬롯 방의 동시 JOIN 50개 중 정확히 하나만 성공한다', async () => {
    const registry = new RoomRegistry();
    const service = new RoomService(registry);
    const hostToken = generateSessionToken();
    const host = createPlayer('호스트', hashSessionToken(hostToken), true, false);
    const room = registry.create('NORMAL', host);
    const hostConnection = fakeConnection('host');
    hostConnection.roomCode = room.roomCode;
    hostConnection.playerId = host.playerId;
    room.connections.set(host.playerId, hostConnection);

    for (let index = 0; index < 28; index += 1) {
      service.join(
        room,
        `참여자${index}`,
        undefined,
        fakeConnection(`existing-${index}`),
        crypto.randomUUID()
      );
    }
    expect(room.players.size).toBe(29);

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, index) =>
        room.queue.enqueue(() => service.join(
          room,
          `경합${index}`,
          undefined,
          fakeConnection(`racer-${index}`),
          crypto.randomUUID()
        ))
      )
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) =>
      result.status === 'rejected' && result.reason?.code === 'ROOM_FULL'
    )).toHaveLength(49);
    expect(room.players.size).toBe(30);
  });

  it('호스트 부재 30분 후 방을 닫고 hostId를 바꾸지 않는다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T00:00:00Z'));
    const registry = new RoomRegistry();
    const service = new RoomService(registry);
    const token = generateSessionToken();
    const host = createPlayer('원래호스트', hashSessionToken(token), true, false);
    const room = registry.create('NORMAL', host);
    const connection = fakeConnection('host');
    connection.roomCode = room.roomCode;
    connection.playerId = host.playerId;
    room.connections.set(host.playerId, connection);
    const originalHostId = room.hostId;

    service.disconnect(connection);
    await room.queue.enqueue(() => undefined);
    expect(room.hostId).toBe(originalHostId);
    expect(room.hostDisconnectedAt).not.toBeNull();
    expect(room.expiresAt! - room.hostDisconnectedAt!).toBe(30 * 60 * 1000);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    await room.queue.enqueue(() => undefined);
    expect(room.hostId).toBe(originalHostId);
    expect(registry.rooms.has(room.roomCode)).toBe(false);
    vi.useRealTimers();
  });
});
