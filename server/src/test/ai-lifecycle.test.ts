import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

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
type RoomRuntime = import('../rooms/types.js').RoomRuntime;

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
  const hostConnection = fakeConnection('host');
  hostConnection.roomCode = room.roomCode;
  hostConnection.playerId = host.playerId;
  room.connections.set(host.playerId, hostConnection);
  return { registry, room, host, aiService, gameService, drawingService, roomService };
};

const addHuman = (room: RoomRuntime, nickname: string) => {
  const player = createPlayer(nickname, hashSessionToken(generateSessionToken()), false, false);
  const connection = fakeConnection(nickname);
  connection.roomCode = room.roomCode;
  connection.playerId = player.playerId;
  room.players.set(player.playerId, player);
  room.connections.set(player.playerId, connection);
  return player;
};

const squarePlan = {
  strokes: [{
    color: 'BLACK',
    width: 'MEDIUM',
    points: Array.from({ length: 20 }, (_, i) => [0.3 + i * 0.02, 0.4])
  }]
};

describe('AI 뒷정리', () => {
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

  it('방이 닫히면 예약해 둔 AI 작업도 함께 버린다', async () => {
    const { room, host, aiService, gameService, roomService } = setup();
    askAboutImage.mockResolvedValue('{"guess":"사과"}');
    aiService.addPlayers(room, host.playerId, 2);
    gameService.startRound(room, host.playerId, room.round.roundId, '사과');
    // AI들이 추측 차례를 잡아 둔 상태를 만든다.
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    roomService.closeRoom(room, 'HOST_LEFT');

    // 방이 사라졌는데도 타이머가 남아 있으면, 없는 방을 붙들고 깨어난다.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('AI가 그릴 수 없는 상태가 이어져도 예약이 쌓이지 않는다', async () => {
    const { room, host, aiService, roomService } = setup();
    askJson.mockResolvedValue(squarePlan);
    aiService.addPlayers(room, host.playerId, 1);
    const ai = [...room.players.values()].find((player) => player.isAI)!;
    // AI가 그릴 차례인데 맞힐 사람이 없다. 호스트가 나가 혼자 남은 상황.
    room.drawerId = ai.playerId;
    room.players.delete(host.playerId);
    room.connections.delete(host.playerId);

    // 그림이 그려질 때처럼 상태가 자주 바뀌는 상황을 만든다.
    for (let i = 0; i < 30; i += 1) {
      roomService.publishState(room);
      await vi.advanceTimersByTimeAsync(1500);
    }

    // 시도할 때마다 하나씩 쌓이면 방이 살아 있는 내내 늘어난다.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
  });

  it('그리는 도중 캔버스를 지워도 남은 획이 조용히 사라진다', async () => {
    const { room, host, aiService, gameService, drawingService } = setup();
    askJson.mockResolvedValue(squarePlan);
    aiService.addPlayers(room, host.playerId, 1);
    addHuman(room, '사람');
    const ai = [...room.players.values()].find((player) => player.isAI)!;
    gameService.assignDrawer(room, host.playerId, ai.playerId);
    await vi.advanceTimersByTimeAsync(2000);
    expect(room.round.status).toBe('DRAWING_AND_GUESSING');

    // AI가 첫 배치를 흘려보낸 뒤, 그리기 담당자가 캔버스를 지운다.
    await vi.advanceTimersByTimeAsync(300);
    drawingService.clear(room, ai.playerId, {
      roundId: room.round.roundId,
      drawingRevision: room.round.drawing.drawingRevision,
      drawerEpoch: room.round.drawing.drawerEpoch
    });
    const revisionAfterClear = room.round.drawing.drawingRevision;

    // 남은 배치가 밀려 들어와도 예외가 새거나 캔버스가 되살아나면 안 된다.
    await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow();
    expect(room.round.drawing.drawingRevision).toBe(revisionAfterClear);
    expect(room.round.drawing.strokes).toHaveLength(0);
  });

  it('라운드가 끝난 뒤에는 추측 차례가 다시 잡히지 않는다', async () => {
    const { room, host, aiService, gameService } = setup();
    askAboutImage.mockResolvedValue('{"guess":"사과"}');
    aiService.addPlayers(room, host.playerId, 1);
    gameService.startRound(room, host.playerId, room.round.roundId, '사과');
    await vi.advanceTimersByTimeAsync(12_000);
    const callsDuringRound = askAboutImage.mock.calls.length;

    gameService.returnToWaiting(room, host.playerId, room.round.roundId);
    await vi.advanceTimersByTimeAsync(30_000);

    // 라운드가 끝났는데도 계속 물어보면 돈만 나간다.
    expect(askAboutImage.mock.calls.length).toBe(callsDuringRound);
  });
});
