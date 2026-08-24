import { beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { AiService } from '../ai/aiService.js';
import { passwordMatches } from '../ai/auth.js';
import { isAiAvailable, loadAiConfig, resetAiConfigForTest } from '../ai/config.js';
import { sanitizePlan } from '../ai/drawPlan.js';
import { pickAiNickname } from '../ai/names.js';
import { parseJsonReply, resetProviderForTest } from '../ai/provider.js';
import { renderStrokesToPng } from '../ai/strokeRender.js';
import { DrawingService } from '../drawing/drawingService.js';
import { GameService } from '../game/gameService.js';
import { allowedActionsFor } from '../game/permissionService.js';
import { ProtocolError } from '../protocol/errors.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import { createPlayer, generateSessionToken, hashSessionToken, RoomService } from '../rooms/roomService.js';
import type { ClientConnection, RoomRuntime, Player } from '../rooms/types.js';
import type { Stroke } from '../../../shared/src/index.js';

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

const setup = () => {
  const registry = new RoomRegistry();
  const roomService = new RoomService(registry);
  const gameService = new GameService(registry, roomService);
  const drawingService = new DrawingService(gameService, roomService);
  const aiService = new AiService(registry, roomService, gameService, drawingService);
  const host = createPlayer('호스트', hashSessionToken(generateSessionToken()), true, false);
  const room = registry.create('NORMAL', host);
  const hostConnection = fakeConnection('host');
  hostConnection.roomCode = room.roomCode;
  hostConnection.playerId = host.playerId;
  room.connections.set(host.playerId, hostConnection);
  return { registry, room, host, hostConnection, aiService, gameService };
};

const addGuesser = (room: RoomRuntime, nickname: string): Player => {
  const player = createPlayer(nickname, hashSessionToken(generateSessionToken()), false, false);
  const connection = fakeConnection(nickname);
  connection.roomCode = room.roomCode;
  connection.playerId = player.playerId;
  room.players.set(player.playerId, player);
  room.connections.set(player.playerId, connection);
  return player;
};

describe('AI 비밀번호', () => {
  it('같은 비밀번호만 통과시킨다', () => {
    expect(passwordMatches('열려라참깨', '열려라참깨')).toBe(true);
    expect(passwordMatches('열려라참깨 ', '열려라참깨')).toBe(false);
    expect(passwordMatches('다른비번', '열려라참깨')).toBe(false);
  });

  it('서버에 비밀번호가 없으면 무엇을 넣어도 통과하지 못한다', () => {
    expect(passwordMatches('', '')).toBe(false);
    expect(passwordMatches('아무거나', '')).toBe(false);
  });
});

describe('AI 설정', () => {
  it('provider 하나와 비밀번호가 모두 있어야 AI를 켤 수 있다', () => {
    expect(isAiAvailable(loadAiConfig({ GEMINI_API_KEY: 'k', AI_PASSWORD: 'p' }))).toBe(true);
    expect(isAiAvailable(loadAiConfig({ GEMINI_API_KEY: 'k' }))).toBe(false);
    expect(isAiAvailable(loadAiConfig({ AI_PASSWORD: 'p' }))).toBe(false);
    expect(isAiAvailable(loadAiConfig({}))).toBe(false);
  });

  it('AI_PROVIDER를 적지 않으면 gemini를 고른다', () => {
    const [first] = loadAiConfig({ GEMINI_API_KEY: 'k', AI_PASSWORD: 'p' }).providers;

    expect(first!.name).toBe('gemini');
    expect(first!.baseUrl).toContain('generativelanguage.googleapis.com');
    expect(first!.drawModel).toBe('gemini-2.5-flash');
    // Gemini는 한 모델이 글과 그림을 모두 본다.
    expect(first!.visionModel).toBe(first!.drawModel);
  });

  it('쉼표로 적은 순서대로 provider를 늘어놓는다', () => {
    const config = loadAiConfig({
      AI_PROVIDER: 'openrouter,gemini',
      OPENROUTER_API_KEY: 'or',
      GEMINI_API_KEY: 'gm',
      AI_PASSWORD: 'p'
    });

    expect(config.providers.map((provider) => provider.name)).toEqual(['openrouter', 'gemini']);
    // 무료로 도는 라우터를 먼저 쓴다.
    expect(config.providers[0]!.drawModel).toBe('openrouter/free');
  });

  it('키가 없는 provider는 목록에서 빠진다', () => {
    const config = loadAiConfig({
      AI_PROVIDER: 'openrouter,gemini', GEMINI_API_KEY: 'gm', AI_PASSWORD: 'p'
    });

    // OpenRouter 키를 넣지 않았으므로 헛되이 부르지 않는다.
    expect(config.providers.map((provider) => provider.name)).toEqual(['gemini']);
  });

  it('키가 하나도 없으면 AI를 켜지 않는다', () => {
    const config = loadAiConfig({ AI_PROVIDER: 'openrouter,gemini', AI_PASSWORD: 'p' });

    expect(config.providers).toHaveLength(0);
    expect(isAiAvailable(config)).toBe(false);
  });

  it('provider마다 제 키와 주소를 읽는다', () => {
    const [deepseek] = loadAiConfig({
      AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'ds', AI_PASSWORD: 'p'
    }).providers;

    expect(deepseek!.apiKey).toBe('ds');
    expect(deepseek!.baseUrl).toContain('api.deepseek.com');
    // DeepSeek만 그림을 보는 모델이 따로 있다.
    expect(deepseek!.visionModel).not.toBe(deepseek!.drawModel);
  });

  it('다른 provider의 키를 가져다 쓰지 않는다', () => {
    const config = loadAiConfig({
      AI_PROVIDER: 'gemini', DEEPSEEK_API_KEY: 'ds', AI_PASSWORD: 'p'
    });

    expect(config.providers).toHaveLength(0);
    expect(isAiAvailable(config)).toBe(false);
  });

  it('알 수 없는 이름과 중복은 버린다', () => {
    const config = loadAiConfig({
      AI_PROVIDER: '뭔가이상한것, GEMINI ,gemini',
      GEMINI_API_KEY: 'k',
      AI_PASSWORD: 'p'
    });

    expect(config.providers.map((provider) => provider.name)).toEqual(['gemini']);
  });

  it('모델 이름을 환경변수로 바꿔 끼울 수 있다', () => {
    const [first] = loadAiConfig({
      GEMINI_API_KEY: 'k', AI_PASSWORD: 'p', GEMINI_MODEL: 'gemini-3.5-flash'
    }).providers;

    expect(first!.drawModel).toBe('gemini-3.5-flash');
  });

  it('추측 간격을 늘려 무료 한도에 맞출 수 있다', () => {
    expect(loadAiConfig({ AI_GUESS_INTERVAL_MS: '15000' }).guessIntervalMs).toBe(15_000);
    // 너무 짧게 잡아 한도를 두드리는 일이 없게 최솟값을 둔다.
    expect(loadAiConfig({ AI_GUESS_INTERVAL_MS: '10' }).guessIntervalMs).toBe(3000);
  });
});

describe('그리기 계획 정리', () => {
  it('범위를 벗어난 좌표를 캔버스 안으로 접어 넣는다', () => {
    const plan = sanitizePlan({
      strokes: [{ color: 'BLUE', width: 'THIN', points: [[-3, 0.5], [2, 1.5], [0.2, 0.2]] }]
    });

    expect(plan).toHaveLength(1);
    expect(plan[0]!.points).toEqual([
      { x: 0, y: 0.5 },
      { x: 1, y: 1 },
      { x: 0.2, y: 0.2 }
    ]);
  });

  it('[x, y]와 {x, y} 두 형태를 모두 받아들인다', () => {
    const plan = sanitizePlan({
      strokes: [{ points: [[0.1, 0.2], { x: 0.3, y: 0.4 }] }]
    });

    expect(plan[0]!.points).toEqual([{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }]);
  });

  it('알 수 없는 색과 굵기는 기본값으로 되돌린다', () => {
    const plan = sanitizePlan({ strokes: [{ color: '무지개', width: '초굵게', points: [[0.5, 0.5]] }] });

    expect(plan[0]!.color).toBe('BLACK');
    expect(plan[0]!.width).toBe('MEDIUM');
  });

  it('그릴 수 없는 응답은 빈 계획으로 만든다', () => {
    expect(sanitizePlan(null)).toEqual([]);
    expect(sanitizePlan({})).toEqual([]);
    expect(sanitizePlan({ strokes: [{ points: [] }, { points: 'nope' }] })).toEqual([]);
  });
});

describe('모델 응답 파싱', () => {
  it('마크다운 코드 블록에 싸여 와도 읽어 낸다', () => {
    expect(parseJsonReply('```json\n{"guess":"사과"}\n```')).toEqual({ guess: '사과' });
  });

  it('JSON이 아니면 null을 준다', () => {
    expect(parseJsonReply('그건 사과 같네요')).toBeNull();
  });
});

describe('캔버스 렌더링', () => {
  it('선을 PNG로 그려 낸다', () => {
    const stroke: Stroke = {
      strokeId: 's1',
      authorId: 'a',
      roundId: 'r',
      drawingRevision: 0,
      drawerEpoch: 0,
      tool: 'PEN',
      color: 'BLACK',
      width: 'MEDIUM',
      points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }],
      finalized: true,
      lastBatchSeq: 0,
      undone: false,
      createdAt: 0
    };
    const png = renderStrokesToPng([stroke]);

    // PNG 시그니처로 실제 이미지가 나왔는지 본다.
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    // 되돌린 획만 있으면 빈 종이라 더 작게 나온다.
    expect(png.length).toBeGreaterThan(renderStrokesToPng([{ ...stroke, undone: true }]).length);
  });
});

describe('AI 닉네임', () => {
  it('이미 있는 이름을 피해 고른다', () => {
    const first = pickAiNickname(new Set());
    const second = pickAiNickname(new Set([first]));

    expect(second).not.toBe(first);
  });
});

describe('AI 참여자 관리', () => {
  beforeEach(() => {
    resetProviderForTest();
    delete process.env.AI_PROVIDER;
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.AI_PASSWORD = 'test-password';
    // 설정은 한 번 읽고 캐시되므로, 환경을 바꾼 뒤에는 캐시를 비워야 한다.
    resetAiConfigForTest();
  });

  it('빈 자리보다 많이 넣어 달라고 해도 자리 수만큼만 넣는다', () => {
    const { room, host, aiService } = setup();
    // 정원 30명 중 호스트 한 명이 이미 앉아 있다.
    const added = aiService.addPlayers(room, host.playerId, 100);

    expect(added).toBe(29);
    expect(room.players.size).toBe(30);
  });

  it('자리가 다 차면 더 넣지 못한다', () => {
    const { room, host, aiService } = setup();
    aiService.addPlayers(room, host.playerId, 29);

    expect(() => aiService.addPlayers(room, host.playerId, 1))
      .toThrow(expect.objectContaining({ code: 'ROOM_FULL' }) as unknown as ProtocolError);
  });

  it('호스트나 진행자가 아니면 AI를 넣을 수 없다', () => {
    const { room, aiService } = setup();
    const guest = addGuesser(room, '참가자');

    expect(() => aiService.addPlayers(room, guest.playerId, 1))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }) as unknown as ProtocolError);
  });

  it('AI가 아닌 참여자는 이 경로로 내보낼 수 없다', () => {
    const { room, host, aiService } = setup();
    const guest = addGuesser(room, '사람');

    expect(() => aiService.removePlayer(room, host.playerId, guest.playerId))
      .toThrow(expect.objectContaining({ code: 'AI_NOT_FOUND' }) as unknown as ProtocolError);
  });

  it('내보낸 AI는 순환 순서에서도 빠진다', () => {
    const { room, host, aiService } = setup();
    aiService.addPlayers(room, host.playerId, 1);
    const ai = [...room.players.values()].find((player) => player.isAI)!;
    room.rotationPlayerIds = [host.playerId, ai.playerId];

    aiService.removePlayer(room, host.playerId, ai.playerId);

    expect(room.players.has(ai.playerId)).toBe(false);
    expect(room.rotationPlayerIds).toEqual([host.playerId]);
  });

  it('그리던 AI를 내보내면 그리기 권한과 제시어가 호스트에게 넘어간다', () => {
    const { room, host, aiService, gameService } = setup();
    aiService.addPlayers(room, host.playerId, 1);
    addGuesser(room, '추측하는사람');
    const ai = [...room.players.values()].find((player) => player.isAI)!;
    gameService.assignDrawer(room, host.playerId, ai.playerId);
    gameService.startRound(room, ai.playerId, room.round.roundId, '사과');
    const epochBefore = room.round.drawing.drawerEpoch;

    aiService.removePlayer(room, host.playerId, ai.playerId);

    expect(room.players.has(ai.playerId)).toBe(false);
    expect(room.drawerId).toBe(host.playerId);
    // 에폭이 올라가야 넘겨받기 전 획이 뒤늦게 들어오는 일을 막는다.
    expect(room.round.drawing.drawerEpoch).toBe(epochBefore + 1);
    expect(room.round.keywordExposedPlayerIds.has(host.playerId)).toBe(true);
  });

  it('AI는 연결이 없어도 참여자로 세어져 라운드를 시작할 수 있다', () => {
    const { room, host, aiService, gameService } = setup();
    aiService.addPlayers(room, host.playerId, 1);

    // 호스트가 그리고 AI가 맞히는 구도. 사람 추측자가 없어도 시작된다.
    expect(() => gameService.startRound(room, host.playerId, room.round.roundId, '사과'))
      .not.toThrow();
    expect(room.round.status).toBe('DRAWING_AND_GUESSING');
  });

  it('호스트에게 AI 관리 권한이 열린다', () => {
    const { room, host, aiService } = setup();
    const before = allowedActionsFor(room, host);

    expect(before).toContain('ADD_AI_PLAYER');
    expect(before).not.toContain('REMOVE_AI_PLAYER');

    aiService.addPlayers(room, host.playerId, 1);

    expect(allowedActionsFor(room, host)).toContain('REMOVE_AI_PLAYER');
  });

  it('일반 참여자에게는 AI 관리 권한이 열리지 않는다', () => {
    const { room } = setup();
    const guest = addGuesser(room, '참가자');

    expect(allowedActionsFor(room, guest)).not.toContain('ADD_AI_PLAYER');
  });
});
