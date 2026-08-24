import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

// 실제 DeepSeek 호출 대신 가짜 응답을 돌려준다. 키 없이도 AI가 제시어를 고르고
// 그림을 그리고 추측을 내놓는 전체 경로를 확인할 수 있다.
const askJson = vi.fn();
const askAboutImage = vi.fn();
vi.mock('../ai/provider.js', () => ({
  getProvider: () => ({ askJson, askAboutImage }),
  isCoolingDown: () => false,
  parseJsonReply: (raw: string) => JSON.parse(raw),
  resetProviderForTest: () => undefined
}));

const { resetAiConfigForTest } = await import('../ai/config.js');
const { AiService } = await import('../ai/aiService.js');
const { DrawingService } = await import('../drawing/drawingService.js');
const { GameService } = await import('../game/gameService.js');
const { RoomRegistry } = await import('../rooms/roomRegistry.js');
const { createPlayer, generateSessionToken, hashSessionToken, RoomService } =
  await import('../rooms/roomService.js');
type ClientConnection = import('../rooms/types.js').ClientConnection;

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
  aiAuthorized: true
});

const setup = () => {
  const registry = new RoomRegistry();
  const roomService = new RoomService(registry);
  const gameService = new GameService(registry, roomService);
  const drawingService = new DrawingService(gameService, roomService);
  const aiService = new AiService(registry, roomService, gameService, drawingService);
  // 디스패처가 실제로 거는 것과 같은 두 훅을 연결한다.
  roomService.onStateChanged = (room) => aiService.onRoomChanged(room);
  roomService.onRoomRemoved = (roomCode) => aiService.forgetRoom(roomCode);

  const host = createPlayer('호스트', hashSessionToken(generateSessionToken()), true, false);
  const room = registry.create('NORMAL', host);
  room.answerMode = 'FIRST_CORRECT';
  const hostConnection = fakeConnection('host');
  hostConnection.roomCode = room.roomCode;
  hostConnection.playerId = host.playerId;
  room.connections.set(host.playerId, hostConnection);
  return { registry, room, host, aiService, gameService, drawingService, roomService };
};

/** 계획대로 네모 하나를 그리는 응답. */
const squarePlan = {
  strokes: [
    {
      color: 'BLACK',
      width: 'MEDIUM',
      points: [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7], [0.3, 0.3]]
    }
  ]
};

describe('AI 진행 흐름', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    askJson.mockReset();
    askAboutImage.mockReset();
    delete process.env.AI_PROVIDER;
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.AI_PASSWORD = 'test-password';
    resetAiConfigForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AI가 그릴 차례가 되면 스스로 제시어를 정하고 라운드를 연다', async () => {
    const { room, host, aiService, gameService } = setup();
    askJson.mockResolvedValue(squarePlan);
    aiService.addPlayers(room, host.playerId, 1);
    const ai = [...room.players.values()].find((player) => player.isAI)!;
    const suggested = room.suggestedKeyword;

    gameService.assignDrawer(room, host.playerId, ai.playerId);
    await vi.advanceTimersByTimeAsync(2000);

    expect(room.round.status).toBe('DRAWING_AND_GUESSING');
    // 서버가 뽑아 둔 추천 제시어를 그대로 쓴다. 모델이 지어내게 두지 않는다.
    expect(room.round.keyword).toBe(suggested);
  });

  it('AI 그리기 담당자는 계획한 선을 캔버스에 실제로 남긴다', async () => {
    const { room, host, aiService, gameService } = setup();
    askJson.mockResolvedValue(squarePlan);
    aiService.addPlayers(room, host.playerId, 1);
    const ai = [...room.players.values()].find((player) => player.isAI)!;

    gameService.assignDrawer(room, host.playerId, ai.playerId);
    await vi.advanceTimersByTimeAsync(5000);

    const strokes = room.round.drawing.strokes;
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes[0]!.authorId).toBe(ai.playerId);
    expect(strokes[0]!.points).toContainEqual({ x: 0.3, y: 0.3 });
    expect(strokes[0]!.finalized).toBe(true);
  });

  it('AI 추측자는 그림을 보고 답을 제출하고, 맞으면 라운드가 끝난다', async () => {
    const { room, host, aiService, gameService, drawingService } = setup();
    askAboutImage.mockResolvedValue('{"guess":"사과"}');
    aiService.addPlayers(room, host.playerId, 1);
    const ai = [...room.players.values()].find((player) => player.isAI)!;

    gameService.startRound(room, host.playerId, room.round.roundId, '사과');
    // 뭐라도 그려져 있어야 AI가 캔버스를 본다.
    drawingService.draw(room, host.playerId, {
      roundId: room.round.roundId,
      drawingRevision: room.round.drawing.drawingRevision,
      drawerEpoch: room.round.drawing.drawerEpoch,
      strokeId: 'stroke-1',
      batchSeq: 0,
      isFinal: true,
      tool: 'PEN',
      color: 'BLACK',
      width: 'MEDIUM',
      points: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }]
    }, null);

    await vi.advanceTimersByTimeAsync(12_000);

    expect(askAboutImage).toHaveBeenCalled();
    expect(room.guessFeed.some((guess) => guess.playerId === ai.playerId)).toBe(true);
    expect(room.round.status).toBe('SOLVED');
    expect(room.round.winnerId).toBe(ai.playerId);
  });

  it('AI 추측에 제시어를 흘리지 않는다', async () => {
    const { room, host, aiService, gameService, drawingService } = setup();
    askAboutImage.mockResolvedValue('{"guess":"바나나"}');
    aiService.addPlayers(room, host.playerId, 1);

    gameService.startRound(room, host.playerId, room.round.roundId, '코끼리');
    drawingService.draw(room, host.playerId, {
      roundId: room.round.roundId,
      drawingRevision: room.round.drawing.drawingRevision,
      drawerEpoch: room.round.drawing.drawerEpoch,
      strokeId: 'stroke-1',
      batchSeq: 0,
      isFinal: true,
      tool: 'PEN',
      color: 'BLACK',
      width: 'MEDIUM',
      points: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }]
    }, null);

    await vi.advanceTimersByTimeAsync(12_000);

    expect(askAboutImage).toHaveBeenCalled();
    for (const call of askAboutImage.mock.calls) {
      // 시스템 문구와 지시문 어디에도 정답이 실려서는 안 된다.
      expect(String(call[0])).not.toContain('코끼리');
      expect(String(call[1])).not.toContain('코끼리');
    }
  });

  it('틀린 답을 되풀이하지 않도록 지난 추측을 알려 준다', async () => {
    const { room, host, aiService, gameService, drawingService } = setup();
    askAboutImage
      .mockResolvedValueOnce('{"guess":"바나나"}')
      .mockResolvedValue('{"guess":"포도"}');
    aiService.addPlayers(room, host.playerId, 1);

    gameService.startRound(room, host.playerId, room.round.roundId, '코끼리');
    drawingService.draw(room, host.playerId, {
      roundId: room.round.roundId,
      drawingRevision: room.round.drawing.drawingRevision,
      drawerEpoch: room.round.drawing.drawerEpoch,
      strokeId: 'stroke-1',
      batchSeq: 0,
      isFinal: true,
      tool: 'PEN',
      color: 'BLACK',
      width: 'MEDIUM',
      points: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }]
    }, null);

    await vi.advanceTimersByTimeAsync(25_000);

    expect(askAboutImage.mock.calls.length).toBeGreaterThan(1);
    const secondInstruction = String(askAboutImage.mock.calls[1]![1]);
    expect(secondInstruction).toContain('바나나');
  });

  it('모델이 답하지 않아도 라운드는 그대로 굴러간다', async () => {
    const { room, host, aiService, gameService, drawingService } = setup();
    askAboutImage.mockResolvedValue(null);
    askJson.mockResolvedValue(null);
    aiService.addPlayers(room, host.playerId, 1);

    gameService.startRound(room, host.playerId, room.round.roundId, '사과');
    drawingService.draw(room, host.playerId, {
      roundId: room.round.roundId,
      drawingRevision: room.round.drawing.drawingRevision,
      drawerEpoch: room.round.drawing.drawerEpoch,
      strokeId: 'stroke-1',
      batchSeq: 0,
      isFinal: true,
      tool: 'PEN',
      color: 'BLACK',
      width: 'MEDIUM',
      points: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }]
    }, null);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(room.round.status).toBe('DRAWING_AND_GUESSING');
    expect(room.guessFeed).toHaveLength(0);
  });

  it('모델 호출이 실패해도 방이 무너지지 않는다', async () => {
    const { room, host, aiService, gameService } = setup();
    askJson.mockRejectedValue(new Error('네트워크 오류'));
    aiService.addPlayers(room, host.playerId, 1);
    const ai = [...room.players.values()].find((player) => player.isAI)!;

    gameService.assignDrawer(room, host.playerId, ai.playerId);
    await vi.advanceTimersByTimeAsync(5000);

    // 제시어는 서버가 고르므로 라운드 자체는 열리고, 그림만 비어 있다.
    expect(room.round.status).toBe('DRAWING_AND_GUESSING');
    expect(room.round.drawing.strokes).toHaveLength(0);
  });

  it('AI가 없는 방에서는 모델을 부르지 않는다', async () => {
    const { room, host, gameService } = setup();
    // 사람끼리 노는 방. 추측할 사람이 있어야 라운드를 열 수 있다.
    const guest = createPlayer('사람', hashSessionToken(generateSessionToken()), false, false);
    const guestConnection = fakeConnection('guest');
    guestConnection.roomCode = room.roomCode;
    guestConnection.playerId = guest.playerId;
    room.players.set(guest.playerId, guest);
    room.connections.set(guest.playerId, guestConnection);

    gameService.startRound(room, host.playerId, room.round.roundId, '사과');
    await vi.advanceTimersByTimeAsync(15_000);

    expect(askJson).not.toHaveBeenCalled();
    expect(askAboutImage).not.toHaveBeenCalled();
  });
});
