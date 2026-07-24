import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { GameService } from '../game/gameService.js';
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
  explicitlyLeft: false
});

const sentEvents = (connection: ClientConnection): Array<{ type: string; payload: any }> =>
  vi.mocked(connection.ws.send).mock.calls.map(([raw]) =>
    JSON.parse(String(raw)) as { type: string; payload: any }
  );

const attachPlayer = (
  room: RoomRuntime,
  nickname: string,
  id: string
): { player: Player; connection: ClientConnection; token: string } => {
  const token = generateSessionToken();
  const player = createPlayer(nickname, hashSessionToken(token), false, false);
  const connection = fakeConnection(id);
  connection.roomCode = room.roomCode;
  connection.playerId = player.playerId;
  room.players.set(player.playerId, player);
  room.connections.set(player.playerId, connection);
  return { player, connection, token };
};

const setupRoom = (mode: 'NORMAL' | 'MODERATOR' = 'NORMAL') => {
  const registry = new RoomRegistry();
  const roomService = new RoomService(registry);
  const gameService = new GameService(registry, roomService);
  const hostToken = generateSessionToken();
  const host = createPlayer(
    mode === 'MODERATOR' ? '진행자' : '호스트',
    hashSessionToken(hostToken),
    true,
    mode === 'MODERATOR'
  );
  const room = registry.create(mode, host);
  room.answerMode = 'FIRST_CORRECT';
  const hostConnection = fakeConnection('host');
  hostConnection.roomCode = room.roomCode;
  hostConnection.playerId = host.playerId;
  room.connections.set(host.playerId, hostConnection);
  return { registry, roomService, gameService, room, host, hostConnection, hostToken };
};

describe('방·세션·권한 강화 검증', () => {
  it('새 방의 기본 정답 모드는 타이머 종료 시까지다', () => {
    const registry = new RoomRegistry();
    const token = generateSessionToken();
    const host = createPlayer('호스트', hashSessionToken(token), true, false);

    expect(registry.create('NORMAL', host).answerMode).toBe('UNTIL_TIMER');
  });

  it('새 방은 고정 그리기와 서버 제시어 기본값으로 시작한다', () => {
    const { room } = setupRoom();

    expect(room.drawerOrderMode).toBe('FIXED');
    expect(room.rotationLaps).toBe(1);
    expect(room.suggestedKeyword).toMatch(/\S/u);
  });

  it('순환 그리기는 지정 바퀴를 마치면 순위를 발표하고 시상식 종료 후 점수를 초기화한다', () => {
    const { room, gameService, host } = setupRoom();
    const first = attachPlayer(room, '첫번째', 'first');
    const second = attachPlayer(room, '두번째', 'second');
    gameService.setDrawerOrder(room, host.playerId, 'ROTATE', 2);

    const oneLap = [
      { drawer: host, answerer: first },
      { drawer: first.player, answerer: second },
      { drawer: second.player, answerer: first }
    ];
    for (const { drawer, answerer } of [...oneLap, ...oneLap]) {
      expect(room.drawerId).toBe(drawer.playerId);
      gameService.startRound(room, drawer.playerId, room.round.roundId, '우산');
      gameService.submitGuess(room, answerer.player.playerId, {
        roundId: room.round.roundId,
        guessId: crypto.randomUUID(),
        text: '우산'
      }, answerer.connection);
    }

    expect(room.status).toBe('RESULTS');
    expect(room.finalRankings).toHaveLength(3);
    expect(room.finalRankings![0]!.score)
      .toBeGreaterThanOrEqual(room.finalRankings![1]!.score);

    gameService.endCeremony(room, host.playerId);
    expect(room.status).toBe('WAITING');
    expect([...room.players.values()].every((player) => player.score === 0)).toBe(true);
    expect(room.rotationPlayerIds).toEqual([]);
  });

  it('그림 담당자는 서버 제시어를 다시 뽑고 직접 입력한 제시어로 시작할 수 있다', () => {
    const { room, gameService, host } = setupRoom();
    const guest = attachPlayer(room, '참가자', 'guest');
    const initialSuggestion = room.suggestedKeyword;

    expect(buildPrivateState(room, host).suggestedKeyword).toBe(initialSuggestion);
    expect(buildPrivateState(room, guest.player).suggestedKeyword).toBeNull();
    gameService.shuffleKeyword(room, host.playerId);
    expect(room.suggestedKeyword).toMatch(/\S/u);
    expect(room.suggestedKeyword).not.toBe(initialSuggestion);

    gameService.startRound(room, host.playerId, room.round.roundId, '직접 입력');
    expect(room.round.keyword).toBe('직접 입력');
  });

  it('준비·진행·종료 상태에서 allowedActions를 역할별로 제한한다', () => {
    const { room, gameService, host } = setupRoom();
    const guest = attachPlayer(room, '참가자', 'guest').player;

    expect(room.durationSeconds).toBe(60);
    gameService.setDuration(room, host.playerId, 20);
    expect(room.durationSeconds).toBe(20);
    expect(allowedActionsFor(room, host)).toEqual(expect.arrayContaining([
      'LEAVE_ROOM',
      'SET_ROUND_DURATION',
      'SET_ANSWER_MODE',
      'SET_KEYWORD_AND_START',
      'ASSIGN_DRAWER',
      'KICK_PLAYER'
    ]));
    expect(allowedActionsFor(room, guest)).toEqual(['LEAVE_ROOM']);

    gameService.startRound(room, host.playerId, room.round.roundId, '고양이');
    expect(() => gameService.setDuration(room, host.playerId, 180))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PHASE' }));
    expect(allowedActionsFor(room, host)).toEqual(expect.arrayContaining([
      'DRAW_STROKE_BATCH',
      'CLEAR_DRAWING'
    ]));
    expect(allowedActionsFor(room, guest)).toEqual(expect.arrayContaining([
      'LEAVE_ROOM',
      'SUBMIT_GUESS'
    ]));
    expect(allowedActionsFor(room, guest)).not.toContain('DRAW_STROKE_BATCH');

    gameService.submitGuess(room, guest.playerId, {
      roundId: room.round.roundId,
      guessId: crypto.randomUUID(),
      text: '고양이'
    }, room.connections.get(guest.playerId)!);
    expect(allowedActionsFor(room, host)).toContain('START_NEXT_ROUND');
    expect(allowedActionsFor(room, guest)).toEqual(['LEAVE_ROOM']);
    const previousRoundId = room.round.roundId;
    const previousRevision = room.round.drawing.drawingRevision;
    gameService.startNextRound(room, host.playerId, previousRoundId);
    expect(room.round.roundNumber).toBe(2);
    expect(room.durationSeconds).toBe(20);
    expect(room.drawerId).toBe(host.playerId);
    expect(room.round.keyword).toBeNull();
    expect(room.guessFeed).toEqual([]);
    expect(room.round.drawing.drawingRevision).toBe(previousRevision + 1);
    expect(gameService.expireRound(room, previousRoundId, Date.now() + 60_000)).toBe(false);
  });

  it('진행 중인 라운드를 대기실로 되돌려도 설정과 누적 점수를 유지한다', () => {
    const { room, gameService, host } = setupRoom();
    attachPlayer(room, '참가자', 'guest');
    host.score = 4;
    gameService.setAnswerMode(room, host.playerId, 'UNTIL_TIMER');
    gameService.startRound(room, host.playerId, room.round.roundId, '우산');
    const activeRoundId = room.round.roundId;

    expect(allowedActionsFor(room, host)).toContain('RETURN_TO_WAITING');
    gameService.returnToWaiting(room, host.playerId, activeRoundId);

    expect(room.status).toBe('WAITING');
    expect(room.round.status).toBe('PREPARING_KEYWORD');
    expect(room.round.roundId).not.toBe(activeRoundId);
    expect(room.answerMode).toBe('UNTIL_TIMER');
    expect(host.score).toBe(4);
    expect(room.roundTimer).toBeNull();
  });

  it('타이머 모드에서 현재 참여자 전원이 맞히면 즉시 라운드를 종료한다', () => {
    const { room, gameService, host, hostConnection } = setupRoom();
    const first = attachPlayer(room, '첫번째', 'first');
    const second = attachPlayer(room, '두번째', 'second');
    gameService.setAnswerMode(room, host.playerId, 'UNTIL_TIMER');
    gameService.startRound(room, host.playerId, room.round.roundId, '우산');

    gameService.submitGuess(room, first.player.playerId, {
      roundId: room.round.roundId,
      guessId: crypto.randomUUID(),
      text: '우산'
    }, first.connection);
    expect(room.status).toBe('ROUND_ACTIVE');

    gameService.submitGuess(room, second.player.playerId, {
      roundId: room.round.roundId,
      guessId: crypto.randomUUID(),
      text: '우산'
    }, second.connection);
    expect(room.status).toBe('ROUND_EXPIRED');
    expect(room.round.status).toBe('EXPIRED');
    expect(room.round.correctPlayerIds.size).toBe(2);
    expect(room.roundTimer).toBeNull();
    expect(sentEvents(hostConnection).filter((event) => event.type === 'ROUND_EXPIRED'))
      .toHaveLength(1);
  });

  it('정답 순위는 참여인원 수부터 차감하고 그림 담당자는 정답자 수만큼 받는다', () => {
    const { room, gameService, host } = setupRoom();
    const first = attachPlayer(room, '첫번째', 'first');
    const second = attachPlayer(room, '두번째', 'second');
    const third = attachPlayer(room, '세번째', 'third');
    gameService.setAnswerMode(room, host.playerId, 'UNTIL_TIMER');
    gameService.startRound(room, host.playerId, room.round.roundId, '우산');

    for (const answerer of [first, second, third]) {
      gameService.submitGuess(room, answerer.player.playerId, {
        roundId: room.round.roundId,
        guessId: crypto.randomUUID(),
        text: '우산'
      }, answerer.connection);
    }

    expect(first.player.score).toBe(4);
    expect(second.player.score).toBe(3);
    expect(third.player.score).toBe(2);
    expect(host.score).toBe(3);
  });

  it('전원이 맞히지 못한 선착순 종료 이벤트에서 정답을 공개한다', () => {
    const { room, gameService, host, hostConnection } = setupRoom();
    const first = attachPlayer(room, '첫번째', 'first');
    attachPlayer(room, '두번째', 'second');
    gameService.startRound(room, host.playerId, room.round.roundId, '우산');

    gameService.submitGuess(room, first.player.playerId, {
      roundId: room.round.roundId,
      guessId: crypto.randomUUID(),
      text: '우산'
    }, first.connection);

    const solved = sentEvents(hostConnection).find((event) => event.type === 'ROUND_SOLVED');
    expect(solved?.payload.answerText).toBe('우산');
  });

  it('종료 후 같은 drawer가 대기실 없이 새 제시어로 다음 라운드를 시작한다', () => {
    const { room, gameService, host } = setupRoom();
    const guest = attachPlayer(room, '참가자', 'guest').player;
    gameService.startRound(room, host.playerId, room.round.roundId, '고양이');
    gameService.submitGuess(room, guest.playerId, {
      roundId: room.round.roundId,
      guessId: crypto.randomUUID(),
      text: '고양이'
    }, room.connections.get(guest.playerId)!);

    const previousRoundId = room.round.roundId;
    const previousDrawerId = room.drawerId;
    const previousScore = host.score;
    expect(allowedActionsFor(room, host)).toContain('SET_KEYWORD_AND_START');

    gameService.startRound(room, host.playerId, previousRoundId, '토끼');

    expect(room.status).toBe('ROUND_ACTIVE');
    expect(room.round.status).toBe('DRAWING_AND_GUESSING');
    expect(room.round.roundNumber).toBe(2);
    expect(room.round.roundId).not.toBe(previousRoundId);
    expect(room.drawerId).toBe(previousDrawerId);
    expect(room.round.keyword).toBe('토끼');
    expect(host.score).toBe(previousScore);
  });

  it('조작된 비권한 명령을 거부하고 NORMAL 대기실의 drawer 지정·회수를 허용한다', () => {
    const { room, roomService, gameService, host } = setupRoom();
    const guest = attachPlayer(room, '참가자', 'guest').player;

    expect(() => gameService.setDuration(room, guest.playerId, 30))
      .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => gameService.startRound(room, guest.playerId, room.round.roundId, '침입'))
      .toThrowError(expect.objectContaining({ code: 'NOT_DRAWER' }));
    gameService.assignDrawer(room, host.playerId, guest.playerId);
    expect(room.drawerId).toBe(guest.playerId);
    expect(room.round.keywordExposedPlayerIds.has(guest.playerId)).toBe(false);
    gameService.reclaimDrawer(room, host.playerId);
    expect(room.drawerId).toBe(host.playerId);
    expect(() => roomService.kick(room, guest.playerId, host.playerId))
      .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));

    room.round.status = 'SOLVED';
    room.status = 'ROUND_SOLVED';
    expect(() => gameService.startNextRound(room, guest.playerId, room.round.roundId))
      .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('강퇴 대상에게만 KICKED를 보내고 token과 nickname 재입장을 모두 차단한다', () => {
    const { room, roomService, host, hostConnection } = setupRoom();
    const joinedConnection = fakeConnection('target');
    roomService.join(room, '강퇴대상', undefined, joinedConnection, crypto.randomUUID());
    const session = sentEvents(joinedConnection).find((event) => event.type === 'ROOM_SESSION')!;
    const targetId = session.payload.playerId as string;
    const targetToken = session.payload.sessionToken as string;
    vi.mocked(hostConnection.ws.send).mockClear();
    vi.mocked(joinedConnection.ws.send).mockClear();

    roomService.kick(room, host.playerId, targetId);
    expect(sentEvents(joinedConnection).filter((event) => event.type === 'KICKED')).toHaveLength(1);
    expect(sentEvents(hostConnection).filter((event) => event.type === 'KICKED')).toHaveLength(0);
    expect(sentEvents(hostConnection).filter((event) => event.type === 'PLAYER_KICKED')).toHaveLength(1);
    expect(joinedConnection.ws.close).toHaveBeenCalledWith(4003, '강퇴되었습니다.');

    expect(() => roomService.join(
      room,
      '강퇴대상',
      targetToken,
      fakeConnection('token-reentry'),
      crypto.randomUUID()
    )).toThrowError(expect.objectContaining({ code: 'REENTRY_BLOCKED' }));
    expect(() => roomService.join(
      room,
      '강퇴대상',
      undefined,
      fakeConnection('nickname-reentry'),
      crypto.randomUUID()
    )).toThrowError(expect.objectContaining({ code: 'REENTRY_BLOCKED' }));
  });

  it('연결 중 token 탈취는 거부하고 끊긴 nickname 슬롯은 같은 playerId로 복구한다', async () => {
    const { room, roomService } = setupRoom();
    const first = fakeConnection('first');
    roomService.join(room, '복구대상', undefined, first, crypto.randomUUID());
    const session = sentEvents(first).find((event) => event.type === 'ROOM_SESSION')!;
    const playerId = session.payload.playerId as string;
    const token = session.payload.sessionToken as string;

    expect(() => roomService.join(
      room,
      '복구대상',
      token,
      fakeConnection('thief'),
      crypto.randomUUID()
    )).toThrowError(expect.objectContaining({ code: 'SESSION_IN_USE' }));
    expect(() => roomService.join(
      room,
      '복구대상',
      undefined,
      fakeConnection('nickname-thief'),
      crypto.randomUUID()
    )).toThrowError(expect.objectContaining({ code: 'NICKNAME_IN_USE' }));

    const differentNickname = fakeConnection('different-nickname');
    roomService.join(room, '다른이름', undefined, differentNickname, crypto.randomUUID());
    expect(differentNickname.playerId).not.toBe(playerId);

    roomService.disconnect(first);
    await room.queue.enqueue(() => undefined);
    const recovered = fakeConnection('recovered');
    roomService.join(room, '복구대상', undefined, recovered, crypto.randomUUID());
    const recoveredSession = sentEvents(recovered).find((event) => event.type === 'ROOM_SESSION')!;
    expect(recoveredSession.payload.playerId).toBe(playerId);
    expect(recoveredSession.payload.isReconnect).toBe(true);
    expect(recoveredSession.payload.sessionToken).not.toBe(token);
  });

  it('명시적 호스트 퇴장은 즉시 방을 닫고 참여자에게 이유를 알린다', () => {
    const { registry, room, roomService, host, hostConnection } = setupRoom();
    const guest = attachPlayer(room, '참가자', 'guest');
    roomService.leave(room, host.playerId, hostConnection);

    expect(registry.rooms.has(room.roomCode)).toBe(false);
    expect(sentEvents(guest.connection).find((event) => event.type === 'ROOM_CLOSED')?.payload.reason)
      .toBe('HOST_LEFT');
  });

  it('900개 방번호가 모두 사용 중이면 명시적인 소진 오류를 낸다', () => {
    const { registry, room } = setupRoom();
    for (let code = 100; code <= 999; code += 1) {
      registry.rooms.set(String(code), room);
    }
    const token = generateSessionToken();
    const anotherHost = createPlayer('새호스트', hashSessionToken(token), true, false);
    expect(() => registry.create('NORMAL', anotherHost))
      .toThrowError(expect.objectContaining({ code: 'ROOM_CODE_EXHAUSTED' }));
  });
});

describe('정답·만료 경합', () => {
  it('공개 오답 feed는 서버 순서대로 최근 100개만 유지한다', () => {
    const { room, gameService, host } = setupRoom();
    const guesser = attachPlayer(room, '다답자', 'many-guesses');
    gameService.startRound(room, host.playerId, room.round.roundId, '정답');
    for (let index = 1; index <= 101; index += 1) {
      gameService.submitGuess(room, guesser.player.playerId, {
        roundId: room.round.roundId,
        guessId: crypto.randomUUID(),
        text: `오답${index}`
      }, guesser.connection);
    }
    expect(room.guessFeed).toHaveLength(100);
    expect(room.guessFeed[0]?.guessSeq).toBe(2);
    expect(room.guessFeed.at(-1)?.guessSeq).toBe(101);
  });

  it('동시 정답 30개를 100회 직렬화해 매회 winner를 하나만 확정한다', async () => {
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const { room, gameService, host, hostConnection, roomService } = setupRoom();
      const guessers = Array.from({ length: 29 }, (_, index) =>
        attachPlayer(room, `참가자${index}`, `guest-${iteration}-${index}`)
      );
      gameService.startRound(room, host.playerId, room.round.roundId, '정답');
      vi.mocked(hostConnection.ws.send).mockClear();

      const results = await Promise.allSettled(
        Array.from({ length: 30 }, (_, index) => room.queue.enqueue(() => {
          const guesser = guessers[index % guessers.length]!;
          gameService.submitGuess(room, guesser.player.playerId, {
            roundId: room.round.roundId,
            guessId: crypto.randomUUID(),
            text: '정 답'
          }, guesser.connection);
        }))
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(room.round.status).toBe('SOLVED');
      expect(room.round.winnerId).not.toBeNull();
      expect(sentEvents(hostConnection).filter((event) => event.type === 'ROUND_SOLVED')).toHaveLength(1);
      expect(sentEvents(hostConnection).filter((event) => event.type === 'GUESS_SHARED')).toHaveLength(1);
      roomService.closeRoom(room, 'SERVER_SHUTDOWN');
    }
  });

  it('solve가 먼저면 SOLVED, expiry가 먼저면 EXPIRED 하나만 남는다', async () => {
    const solvedSetup = setupRoom();
    const solvedGuesser = attachPlayer(solvedSetup.room, '정답자', 'solved-guesser');
    solvedSetup.gameService.startRound(
      solvedSetup.room,
      solvedSetup.host.playerId,
      solvedSetup.room.round.roundId,
      '답'
    );
    const solvedRoundId = solvedSetup.room.round.roundId;
    const solvedEndsAt = solvedSetup.room.round.roundEndsAt!;
    await solvedSetup.room.queue.enqueue(() => solvedSetup.gameService.submitGuess(
      solvedSetup.room,
      solvedGuesser.player.playerId,
      { roundId: solvedRoundId, guessId: crypto.randomUUID(), text: '답' },
      solvedGuesser.connection
    ));
    expect(solvedSetup.gameService.expireRound(
      solvedSetup.room,
      solvedRoundId,
      solvedEndsAt
    )).toBe(false);
    expect(solvedSetup.room.round.status).toBe('SOLVED');

    const expiredSetup = setupRoom();
    const expiredGuesser = attachPlayer(expiredSetup.room, '늦은정답자', 'expired-guesser');
    expiredSetup.gameService.startRound(
      expiredSetup.room,
      expiredSetup.host.playerId,
      expiredSetup.room.round.roundId,
      '답'
    );
    const expiredRoundId = expiredSetup.room.round.roundId;
    const expiredEndsAt = expiredSetup.room.round.roundEndsAt!;
    expect(expiredSetup.gameService.expireRound(
      expiredSetup.room,
      expiredRoundId,
      expiredEndsAt
    )).toBe(true);
    expect(() => expiredSetup.gameService.submitGuess(
      expiredSetup.room,
      expiredGuesser.player.playerId,
      { roundId: expiredRoundId, guessId: crypto.randomUUID(), text: '답' },
      expiredGuesser.connection
    )).toThrowError(expect.objectContaining({ code: 'ROUND_LOCKED' }));
    expect(expiredSetup.room.round.status).toBe('EXPIRED');
  });
});

describe('오류 계약', () => {
  it('ProtocolError는 keyword나 session token 없이 안전한 payload만 만든다', () => {
    const payload = new ProtocolError('INVALID_KEYWORD', '제시어가 올바르지 않습니다.').toPayload();
    expect(JSON.stringify(payload)).not.toContain('secret-keyword');
    expect(JSON.stringify(payload)).not.toContain('sessionToken');
  });
});
