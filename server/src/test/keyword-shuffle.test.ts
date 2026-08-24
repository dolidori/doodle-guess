import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { MAX_KEYWORD_SHUFFLES } from '../../../shared/src/index.js';
import { GameService } from '../game/gameService.js';
import { DEFAULT_KEYWORDS } from '../game/keywordService.js';
import { allowedActionsFor } from '../game/permissionService.js';
import { ProtocolError } from '../protocol/errors.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import {
  createPlayer,
  generateSessionToken,
  hashSessionToken,
  RoomService
} from '../rooms/roomService.js';
import { buildPrivateState } from '../state/privateState.js';
import type { ClientConnection, Player, RoomRuntime } from '../rooms/types.js';

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
  explicitlyLeft: false,
  livenessProbeAt: null,
  aiAuthorized: false
});

const setupRoom = () => {
  const registry = new RoomRegistry();
  const roomService = new RoomService(registry);
  const gameService = new GameService(registry, roomService);
  const host = createPlayer('호스트', hashSessionToken(generateSessionToken()), true, false);
  const room = registry.create('NORMAL', host);
  const hostConnection = fakeConnection('host');
  hostConnection.roomCode = room.roomCode;
  hostConnection.playerId = host.playerId;
  room.connections.set(host.playerId, hostConnection);

  // 라운드를 시작할 수 있도록 추측할 참여자를 한 명 붙인다.
  const guesser: Player = createPlayer('참여자', hashSessionToken(generateSessionToken()), false, false);
  const guesserConnection = fakeConnection('guesser');
  guesserConnection.roomCode = room.roomCode;
  guesserConnection.playerId = guesser.playerId;
  room.players.set(guesser.playerId, guesser);
  room.connections.set(guesser.playerId, guesserConnection);

  return { registry, roomService, gameService, room, host };
};

const remainingFor = (room: RoomRuntime, player: Player): number =>
  buildPrivateState(room, player).remainingKeywordShuffles;

describe('제시어 다시 뽑기 횟수 제한', () => {
  it(`라운드마다 ${MAX_KEYWORD_SHUFFLES}번까지만 다시 뽑을 수 있다`, () => {
    const { gameService, room, host } = setupRoom();

    for (let attempt = 0; attempt < MAX_KEYWORD_SHUFFLES; attempt += 1) {
      expect(remainingFor(room, host)).toBe(MAX_KEYWORD_SHUFFLES - attempt);
      gameService.shuffleKeyword(room, host.playerId);
    }

    expect(remainingFor(room, host)).toBe(0);
    expect(() => gameService.shuffleKeyword(room, host.playerId))
      .toThrowError(expect.objectContaining({ code: 'SHUFFLE_LIMIT' }));
  });

  it('횟수를 다 쓰면 다시 뽑기 권한 자체가 사라진다', () => {
    const { gameService, room, host } = setupRoom();
    expect(allowedActionsFor(room, host)).toContain('SHUFFLE_KEYWORD');

    for (let attempt = 0; attempt < MAX_KEYWORD_SHUFFLES; attempt += 1) {
      gameService.shuffleKeyword(room, host.playerId);
    }

    expect(allowedActionsFor(room, host)).not.toContain('SHUFFLE_KEYWORD');
  });

  it('한도를 넘긴 요청은 제시어를 바꾸지 않는다', () => {
    const { gameService, room, host } = setupRoom();
    for (let attempt = 0; attempt < MAX_KEYWORD_SHUFFLES; attempt += 1) {
      gameService.shuffleKeyword(room, host.playerId);
    }
    const settled = room.suggestedKeyword;

    expect(() => gameService.shuffleKeyword(room, host.playerId)).toThrow(ProtocolError);
    expect(room.suggestedKeyword).toBe(settled);
    expect(room.round.shuffleCount).toBe(MAX_KEYWORD_SHUFFLES);
  });

  it('다음 라운드가 되면 횟수가 다시 채워진다', () => {
    const { gameService, registry, room, host } = setupRoom();
    for (let attempt = 0; attempt < MAX_KEYWORD_SHUFFLES; attempt += 1) {
      gameService.shuffleKeyword(room, host.playerId);
    }
    expect(remainingFor(room, host)).toBe(0);

    registry.nextRound(room);

    expect(room.round.shuffleCount).toBe(0);
    expect(remainingFor(room, host)).toBe(MAX_KEYWORD_SHUFFLES);
    expect(() => gameService.shuffleKeyword(room, host.playerId)).not.toThrow();
  });

  it('그리기 담당자가 아니면 횟수와 무관하게 뽑을 수 없다', () => {
    const { gameService, room } = setupRoom();
    const other = [...room.players.values()].find((player) => !player.isHost)!;

    expect(() => gameService.shuffleKeyword(room, other.playerId))
      .toThrowError(expect.objectContaining({ code: 'NOT_DRAWER' }));
    expect(room.round.shuffleCount).toBe(0);
  });
});

describe('기본 제시어 목록', () => {
  it('중복 없이 넉넉한 수를 싣는다', () => {
    expect(DEFAULT_KEYWORDS.length).toBeGreaterThan(700);
    expect(new Set(DEFAULT_KEYWORDS).size).toBe(DEFAULT_KEYWORDS.length);
  });

  it('공백만 있는 제시어가 없다', () => {
    expect(DEFAULT_KEYWORDS.filter((keyword) => !keyword.trim())).toEqual([]);
  });

  it('그림으로 내기 어려운 속담은 기본 목록에 섞이지 않는다', () => {
    const proverbs = DEFAULT_KEYWORDS.filter((keyword) => keyword.includes(' ') && keyword.length > 12);
    expect(proverbs).toEqual([]);
    expect(DEFAULT_KEYWORDS).not.toContain('티끌 모아 태산');
    expect(DEFAULT_KEYWORDS).not.toContain('식은 죽 먹기');
  });
});
