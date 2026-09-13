import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { MAX_KEYWORD_SHUFFLES } from '../../../shared/src/index.js';
import { GameService } from '../game/gameService.js';
import { allowedActionsFor } from '../game/permissionService.js';
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
  livenessProbeAt: null
});

const attach = (room: RoomRuntime, player: Player, id: string): void => {
  const connection = fakeConnection(id);
  connection.roomCode = room.roomCode;
  connection.playerId = player.playerId;
  room.players.set(player.playerId, player);
  room.connections.set(player.playerId, connection);
};

/** 제시어 잠금은 진행자 모드 전용이라 진행자·담당자·추측자를 갖춰 둔다. */
const setupModeratorRoom = () => {
  const registry = new RoomRegistry();
  const roomService = new RoomService(registry);
  const gameService = new GameService(registry, roomService);
  const moderator = createPlayer('진행자', hashSessionToken(generateSessionToken()), true, true);
  const room = registry.create('MODERATOR', moderator);
  attach(room, moderator, 'moderator');

  const drawer = createPlayer('담당자', hashSessionToken(generateSessionToken()), false, false);
  attach(room, drawer, 'drawer');
  const guesser = createPlayer('추측자', hashSessionToken(generateSessionToken()), false, false);
  attach(room, guesser, 'guesser');

  return { registry, gameService, room, moderator, drawer, guesser };
};

/** 일반 모드에는 진행자가 없어 잠금을 아무도 쓸 수 없어야 한다. */
const setupNormalRoom = () => {
  const registry = new RoomRegistry();
  const roomService = new RoomService(registry);
  const gameService = new GameService(registry, roomService);
  const host = createPlayer('방장', hashSessionToken(generateSessionToken()), true, false);
  const room = registry.create('NORMAL', host);
  attach(room, host, 'host');

  const drawer = createPlayer('담당자', hashSessionToken(generateSessionToken()), false, false);
  attach(room, drawer, 'drawer');
  const guesser = createPlayer('추측자', hashSessionToken(generateSessionToken()), false, false);
  attach(room, guesser, 'guesser');

  return { gameService, room, host, drawer };
};

describe('제시어 잠금', () => {
  it('진행자가 잠그면 그리기 담당자는 다시 뽑기도 제시어 변경도 못 한다', () => {
    const { gameService, room, moderator, drawer } = setupModeratorRoom();
    gameService.lockKeyword(room, moderator.playerId, '코끼리');
    gameService.assignDrawer(room, moderator.playerId, drawer.playerId);

    const actions = allowedActionsFor(room, drawer);
    expect(actions).not.toContain('SHUFFLE_KEYWORD');
    expect(actions).toContain('SET_KEYWORD_AND_START');
    expect(() => gameService.shuffleKeyword(room, drawer.playerId))
      .toThrowError(expect.objectContaining({ code: 'KEYWORD_LOCKED' }));

    // 다른 제시어를 실어 보내도 잠근 제시어로 시작한다.
    gameService.startRound(room, drawer.playerId, room.round.roundId, '기린');
    expect(room.round.keyword).toBe('코끼리');
  });

  it('일반 모드 방장은 제시어를 잠글 수 없다', () => {
    const { gameService, room, host } = setupNormalRoom();
    expect(allowedActionsFor(room, host)).not.toContain('LOCK_KEYWORD');
    expect(() => gameService.lockKeyword(room, host.playerId, '코끼리'))
      .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(room.lockedKeyword).toBeNull();
  });

  it('진행자 모드에서도 일반 참여자는 잠글 수 없다', () => {
    const { gameService, room, guesser } = setupModeratorRoom();
    expect(allowedActionsFor(room, guesser)).not.toContain('LOCK_KEYWORD');
    expect(() => gameService.lockKeyword(room, guesser.playerId, '코끼리'))
      .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(room.lockedKeyword).toBeNull();
  });

  it('잠금을 풀면 담당자의 다시 뽑기 권한이 돌아온다', () => {
    const { gameService, room, moderator, drawer } = setupModeratorRoom();
    gameService.assignDrawer(room, moderator.playerId, drawer.playerId);
    gameService.lockKeyword(room, moderator.playerId, '코끼리');
    expect(allowedActionsFor(room, moderator)).toContain('UNLOCK_KEYWORD');
    expect(allowedActionsFor(room, drawer)).not.toContain('SHUFFLE_KEYWORD');

    gameService.unlockKeyword(room, moderator.playerId);

    expect(room.lockedKeyword).toBeNull();
    expect(allowedActionsFor(room, moderator)).toContain('LOCK_KEYWORD');
    expect(allowedActionsFor(room, drawer)).toContain('SHUFFLE_KEYWORD');
  });

  it('잠긴 제시어는 담당자와 진행자에게만 내려간다', () => {
    const { gameService, room, moderator, drawer, guesser } = setupModeratorRoom();
    gameService.lockKeyword(room, moderator.playerId, '코끼리');
    gameService.assignDrawer(room, moderator.playerId, drawer.playerId);

    expect(buildPrivateState(room, drawer).lockedKeyword).toBe('코끼리');
    expect(buildPrivateState(room, moderator).lockedKeyword).toBe('코끼리');
    expect(buildPrivateState(room, guesser).lockedKeyword).toBeNull();
  });

  it('라운드가 넘어가면 잠금이 풀린다', () => {
    const { gameService, registry, room, moderator } = setupModeratorRoom();
    gameService.lockKeyword(room, moderator.playerId, '코끼리');

    registry.nextRound(room);

    expect(room.lockedKeyword).toBeNull();
  });
});

describe('그리기 권한 인계', () => {
  it('제시어를 보고 넘기면 새로 뽑고 다시 뽑기 횟수를 한 번 쓴다', () => {
    const { gameService, room, host, drawer } = setupNormalRoom();
    gameService.revealKeyword(room, host.playerId);
    const seenByHost = room.suggestedKeyword;

    gameService.assignDrawer(room, host.playerId, drawer.playerId);

    expect(room.suggestedKeyword).not.toBe(seenByHost);
    // 본 사람(방장) 몫만 깎이고 넘겨받은 사람은 그대로 5회다.
    expect(room.round.shuffleCounts.get(host.playerId)).toBe(1);
    expect(buildPrivateState(room, host).remainingKeywordShuffles)
      .toBe(MAX_KEYWORD_SHUFFLES - 1);
    expect(buildPrivateState(room, drawer).remainingKeywordShuffles)
      .toBe(MAX_KEYWORD_SHUFFLES);
    // 넘긴 방장은 새 제시어를 볼 수 없다.
    expect(buildPrivateState(room, host).suggestedKeyword).toBeNull();
  });

  it('보지 않고 넘기면 제시어도 횟수도 그대로다', () => {
    const { gameService, room, host, drawer } = setupNormalRoom();
    const untouched = room.suggestedKeyword;

    gameService.assignDrawer(room, host.playerId, drawer.playerId);

    expect(room.suggestedKeyword).toBe(untouched);
    expect(room.round.shuffleCounts.size).toBe(0);
    expect(buildPrivateState(room, drawer).remainingKeywordShuffles)
      .toBe(MAX_KEYWORD_SHUFFLES);
  });

  it('권한을 되찾을 때도 이전 담당자가 봤는지로 판단한다', () => {
    const { gameService, room, host, drawer } = setupNormalRoom();
    gameService.assignDrawer(room, host.playerId, drawer.playerId);
    const seenByDrawer = room.suggestedKeyword;

    // 담당자가 보지 않았으면 되찾아도 그대로다.
    gameService.reclaimDrawer(room, host.playerId);
    expect(room.suggestedKeyword).toBe(seenByDrawer);
    expect(room.round.shuffleCounts.size).toBe(0);

    // 봤다면 되찾을 때 새로 뽑힌다.
    gameService.assignDrawer(room, host.playerId, drawer.playerId);
    gameService.revealKeyword(room, drawer.playerId);
    gameService.reclaimDrawer(room, host.playerId);
    expect(room.suggestedKeyword).not.toBe(seenByDrawer);
    // 본 사람(담당자) 몫만 깎이고 되찾은 방장은 그대로다.
    expect(room.round.shuffleCounts.get(drawer.playerId)).toBe(1);
    expect(buildPrivateState(room, host).remainingKeywordShuffles)
      .toBe(MAX_KEYWORD_SHUFFLES);
  });

  it('다시 뽑으면 열람 기록이 지워져 이어서 넘겨도 깎이지 않는다', () => {
    const { gameService, room, host, drawer } = setupNormalRoom();
    gameService.revealKeyword(room, host.playerId);
    gameService.shuffleKeyword(room, host.playerId);
    const fresh = room.suggestedKeyword;

    gameService.assignDrawer(room, host.playerId, drawer.playerId);

    expect(room.suggestedKeyword).toBe(fresh);
    expect(room.round.shuffleCounts.get(host.playerId)).toBe(1);
  });

  it('라운드가 끝나고 대기실로 돌아가면 횟수가 다시 채워진다', () => {
    const { gameService, room, host, drawer } = setupNormalRoom();
    gameService.revealKeyword(room, host.playerId);
    gameService.assignDrawer(room, host.playerId, drawer.playerId);
    gameService.startRound(room, drawer.playerId, room.round.roundId, '코끼리');
    expect(room.round.shuffleCounts.get(host.playerId)).toBe(1);

    gameService.returnToWaiting(room, host.playerId, room.round.roundId);

    expect(room.round.shuffleCounts.size).toBe(0);
    expect(room.suggestedKeywordSeenBy.size).toBe(0);
    gameService.reclaimDrawer(room, host.playerId);
    expect(buildPrivateState(room, host).remainingKeywordShuffles)
      .toBe(MAX_KEYWORD_SHUFFLES);
  });

  it('잠긴 제시어는 보고 넘겨도 그대로 가고 횟수도 안 깎인다', () => {
    const { gameService, room, moderator, drawer } = setupModeratorRoom();
    gameService.lockKeyword(room, moderator.playerId, '코끼리');
    gameService.revealKeyword(room, moderator.playerId);

    gameService.assignDrawer(room, moderator.playerId, drawer.playerId);

    expect(room.lockedKeyword).toBe('코끼리');
    expect(room.round.shuffleCounts.size).toBe(0);
    expect(buildPrivateState(room, drawer).lockedKeyword).toBe('코끼리');
  });

  it('담당자가 아니면 열람을 신고할 수 없다', () => {
    const { gameService, room, drawer } = setupNormalRoom();
    expect(() => gameService.revealKeyword(room, drawer.playerId))
      .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(room.suggestedKeywordSeenBy.size).toBe(0);
  });
});

describe('라운드 종료 직후 담당자 교체', () => {
  it('대기실을 거치지 않고 바로 다음 담당자에게 넘길 수 있다', () => {
    const { gameService, room, host, drawer } = setupNormalRoom();
    gameService.assignDrawer(room, host.playerId, drawer.playerId);
    gameService.startRound(room, drawer.playerId, room.round.roundId, '코끼리');
    gameService.expireRound(room, room.round.roundId, Date.now() + 120_000);
    expect(room.round.status).toBe('EXPIRED');

    expect(allowedActionsFor(room, host)).toContain('ASSIGN_DRAWER');
    expect(allowedActionsFor(room, host)).toContain('RECLAIM_DRAWER');

    gameService.reclaimDrawer(room, host.playerId);
    expect(room.drawerId).toBe(host.playerId);
    // 끝난 라운드의 정답을 새로 본 것은 아니다.
    expect(room.round.keywordExposedPlayerIds.has(host.playerId)).toBe(false);
  });

  it('종료 화면에서도 본 제시어는 넘길 때 새로 뽑힌다', () => {
    const { gameService, room, host, drawer } = setupNormalRoom();
    gameService.assignDrawer(room, host.playerId, drawer.playerId);
    gameService.startRound(room, drawer.playerId, room.round.roundId, '코끼리');
    gameService.expireRound(room, room.round.roundId, Date.now() + 120_000);

    // 담당자가 다음 라운드 제시어를 열어 봤다.
    gameService.revealKeyword(room, drawer.playerId);
    const seenByDrawer = room.suggestedKeyword;

    gameService.reclaimDrawer(room, host.playerId);

    expect(room.suggestedKeyword).not.toBe(seenByDrawer);
  });

  it('시상식 중에는 담당자를 바꿀 수 없다', () => {
    const { gameService, room, host, drawer } = setupNormalRoom();
    gameService.assignDrawer(room, host.playerId, drawer.playerId);
    gameService.startRound(room, drawer.playerId, room.round.roundId, '코끼리');
    gameService.expireRound(room, room.round.roundId, Date.now() + 120_000);
    room.status = 'RESULTS';

    expect(allowedActionsFor(room, host)).not.toContain('ASSIGN_DRAWER');
    expect(() => gameService.reclaimDrawer(room, host.playerId))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PHASE' }));
  });
});
