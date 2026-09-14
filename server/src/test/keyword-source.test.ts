import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { GameService } from '../game/gameService.js';
import {
  DEFAULT_KEYWORDS,
  DEFAULT_PROVERBS,
  keywordPool,
  normalizeGuess
} from '../game/keywordService.js';
import { allowedActionsFor } from '../game/permissionService.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import {
  createPlayer,
  generateSessionToken,
  hashSessionToken,
  RoomService
} from '../rooms/roomService.js';
import { buildPublicState } from '../state/publicState.js';
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
  livenessProbeAt: null
});

const attach = (room: RoomRuntime, player: Player, id: string): void => {
  const connection = fakeConnection(id);
  connection.roomCode = room.roomCode;
  connection.playerId = player.playerId;
  room.players.set(player.playerId, player);
  room.connections.set(player.playerId, connection);
};

const setupRoom = (mode: 'NORMAL' | 'MODERATOR' = 'NORMAL') => {
  const registry = new RoomRegistry();
  const roomService = new RoomService(registry);
  const gameService = new GameService(registry, roomService);
  const host = createPlayer('방장', hashSessionToken(generateSessionToken()), true, mode === 'MODERATOR');
  const room = registry.create(mode, host);
  attach(room, host, 'host');
  const guesser = createPlayer('추측자', hashSessionToken(generateSessionToken()), false, false);
  attach(room, guesser, 'guesser');
  return { registry, gameService, room, host, guesser };
};

const proverbSet = new Set(DEFAULT_PROVERBS.map((entry) => entry.text));

describe('속담 제시어 목록', () => {
  it('150개를 중복 없이 싣고 제시어 길이 상한을 지킨다', () => {
    expect(DEFAULT_PROVERBS).toHaveLength(150);
    expect(proverbSet.size).toBe(DEFAULT_PROVERBS.length);
    for (const entry of DEFAULT_PROVERBS) {
      expect([...entry.text].length).toBeLessThanOrEqual(50);
      expect(normalizeGuess(entry.text).length).toBeGreaterThan(0);
    }
  });

  it('단어 목록과 겹치지 않는다', () => {
    const words = new Set(DEFAULT_KEYWORDS);
    expect(DEFAULT_PROVERBS.filter((entry) => words.has(entry.text))).toEqual([]);
  });

  it('난이도별로 풀을 좁힌다', () => {
    expect(keywordPool('WORD', 'ALL')).toBe(DEFAULT_KEYWORDS);
    expect(keywordPool('PROVERB', 'ALL')).toHaveLength(150);
    for (const level of ['EASY', 'NORMAL', 'HARD'] as const) {
      const pool = keywordPool('PROVERB', level);
      expect(pool.length).toBeGreaterThan(0);
      const expected = DEFAULT_PROVERBS.filter((entry) => entry.difficulty === level);
      expect(pool).toHaveLength(expected.length);
    }
    const sizes = (['EASY', 'NORMAL', 'HARD'] as const)
      .map((level) => keywordPool('PROVERB', level).length);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(150);
  });
});

describe('제시어 종류 설정', () => {
  it('일반 모드 방장이 속담으로 바꾸면 추천 제시어가 속담에서 나온다', () => {
    const { gameService, room, host } = setupRoom();
    expect(proverbSet.has(room.suggestedKeyword)).toBe(false);

    gameService.setKeywordSource(room, host.playerId, 'PROVERB', 'ALL');

    expect(room.keywordSource).toBe('PROVERB');
    expect(proverbSet.has(room.suggestedKeyword)).toBe(true);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      gameService.shuffleKeyword(room, host.playerId);
      expect(proverbSet.has(room.suggestedKeyword)).toBe(true);
      room.round.shuffleCounts.clear();
    }
  });

  it('진행자 모드 진행자도 바꿀 수 있다', () => {
    const { gameService, room, host } = setupRoom('MODERATOR');
    expect(allowedActionsFor(room, host)).toContain('SET_KEYWORD_SOURCE');

    gameService.setKeywordSource(room, host.playerId, 'PROVERB', 'HARD');

    const hard = new Set(keywordPool('PROVERB', 'HARD'));
    expect(hard.has(room.suggestedKeyword)).toBe(true);
  });

  it('난이도를 좁히면 그 난이도에서만 나온다', () => {
    const { gameService, room, host } = setupRoom();
    gameService.setKeywordSource(room, host.playerId, 'PROVERB', 'EASY');
    const easy = new Set(keywordPool('PROVERB', 'EASY'));

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(easy.has(room.suggestedKeyword)).toBe(true);
      gameService.shuffleKeyword(room, host.playerId);
      room.round.shuffleCounts.clear();
    }
  });

  it('단어로 되돌리면 다시 단어에서 나온다', () => {
    const { gameService, room, host } = setupRoom();
    gameService.setKeywordSource(room, host.playerId, 'PROVERB', 'ALL');
    expect(proverbSet.has(room.suggestedKeyword)).toBe(true);

    gameService.setKeywordSource(room, host.playerId, 'WORD', 'ALL');

    expect(proverbSet.has(room.suggestedKeyword)).toBe(false);
    expect(DEFAULT_KEYWORDS).toContain(room.suggestedKeyword);
  });

  it('종류를 바꾸면 열람 기록을 비운다', () => {
    const { gameService, room, host } = setupRoom();
    gameService.revealKeyword(room, host.playerId);
    expect(room.suggestedKeywordSeenBy.size).toBe(1);

    gameService.setKeywordSource(room, host.playerId, 'PROVERB', 'ALL');

    expect(room.suggestedKeywordSeenBy.size).toBe(0);
  });

  it('같은 설정을 다시 보내면 제시어를 바꾸지 않는다', () => {
    const { gameService, room, host } = setupRoom();
    const before = room.suggestedKeyword;

    gameService.setKeywordSource(room, host.playerId, 'WORD', 'ALL');

    expect(room.suggestedKeyword).toBe(before);
  });

  it('일반 참여자는 바꿀 수 없다', () => {
    const { gameService, room, guesser } = setupRoom();
    expect(allowedActionsFor(room, guesser)).not.toContain('SET_KEYWORD_SOURCE');
    expect(() => gameService.setKeywordSource(room, guesser.playerId, 'PROVERB', 'ALL'))
      .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(room.keywordSource).toBe('WORD');
  });

  it('제시어가 잠겨 있으면 종류를 바꿀 수 없다', () => {
    const { gameService, room, host } = setupRoom('MODERATOR');
    gameService.lockKeyword(room, host.playerId, '코끼리');

    expect(allowedActionsFor(room, host)).not.toContain('SET_KEYWORD_SOURCE');
    expect(() => gameService.setKeywordSource(room, host.playerId, 'PROVERB', 'ALL'))
      .toThrowError(expect.objectContaining({ code: 'KEYWORD_LOCKED' }));
  });

  it('공개 상태로 방 전체에 알린다', () => {
    const { gameService, room, host } = setupRoom();
    gameService.setKeywordSource(room, host.playerId, 'PROVERB', 'NORMAL');

    const published = buildPublicState(room);
    expect(published.keywordSource).toBe('PROVERB');
    expect(published.proverbDifficulty).toBe('NORMAL');
  });

  it('속담 정답은 띄어쓰기가 달라도 맞는 것으로 본다', () => {
    const proverb = DEFAULT_PROVERBS[0]!.text;
    expect(normalizeGuess(proverb)).toBe(normalizeGuess(proverb.replace(/\s/gu, '')));
  });
});
