import { randomUUID } from 'node:crypto';
import {
  AI_FIRST_GUESS_DELAY_MS,
  AI_STROKE_INTERVAL_MS,
  MAX_POINTS_PER_BATCH,
  ROOM_CAPACITY,
  type StrokeBatchPayload
} from '../../../shared/src/index.js';
import { DrawingService } from '../drawing/drawingService.js';
import { GameService } from '../game/gameService.js';
import { assertProtocol, ProtocolError } from '../protocol/errors.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import { createPlayer, hashSessionToken, RoomService } from '../rooms/roomService.js';
import type { RoomRuntime } from '../rooms/types.js';
import { getAiConfig, isAiAvailable } from './config.js';
import { planDrawing, type PlannedStroke } from './drawPlan.js';
import { guessDrawing } from './guesser.js';
import { pickAiNickname } from './names.js';
import { getProvider, isCoolingDown } from './provider.js';

/** 방 하나에서 AI들이 지금 무엇을 하고 있는지. */
type RoomAiState = {
  /** 그리기를 이미 시작한 라운드. 같은 라운드에 두 번 그리지 않게 막는다. */
  drawnRoundId: string | null;
  /** 제시어를 고르는 중인 라운드. 응답을 기다리는 동안 중복 호출을 막는다. */
  startingRoundId: string | null;
  /** AI별 추측 진행 상태. */
  guessers: Map<string, { inFlight: boolean; rejected: string[] }>;
  timers: Set<NodeJS.Timeout>;
};

const emptyState = (): RoomAiState => ({
  drawnRoundId: null,
  startingRoundId: null,
  guessers: new Map(),
  timers: new Set()
});

export class AiService {
  private readonly states = new Map<string, RoomAiState>();

  constructor(
    private readonly registry: RoomRegistry,
    private readonly roomService: RoomService,
    private readonly gameService: GameService,
    private readonly drawingService: DrawingService
  ) {}

  /** 서버에 키와 비밀번호가 모두 있어야 AI를 쓸 수 있다. */
  isAvailable(): boolean {
    return isAiAvailable(getAiConfig()) && getProvider() !== null;
  }

  private state(roomCode: string): RoomAiState {
    let state = this.states.get(roomCode);
    if (!state) {
      state = emptyState();
      this.states.set(roomCode, state);
    }
    return state;
  }

  /**
   * 지연 작업을 예약한다. 방이 사라질 때 한꺼번에 정리할 수 있도록 모아 둔다.
   * unref를 걸어 두어 AI 타이머 때문에 서버가 종료되지 못하는 일이 없게 한다.
   */
  private later(roomCode: string, delayMs: number, task: () => void): void {
    const state = this.state(roomCode);
    const timer = setTimeout(() => {
      state.timers.delete(timer);
      task();
    }, delayMs);
    timer.unref();
    state.timers.add(timer);
  }

  /** 방이 닫히면 예약된 작업을 모두 버린다. */
  forgetRoom(roomCode: string): void {
    const state = this.states.get(roomCode);
    if (!state) return;
    for (const timer of state.timers) clearTimeout(timer);
    this.states.delete(roomCode);
  }

  // ───────────────────────────── 참여자 관리 ─────────────────────────────

  /**
   * 빈 자리만큼 AI를 넣는다. 인증은 호출하는 쪽(디스패처)에서 이미 끝났다고 본다.
   */
  addPlayers(room: RoomRuntime, actorId: string, count: number): number {
    assertProtocol(this.isAvailable(), 'AI_UNAVAILABLE', '이 서버에는 AI가 설정되어 있지 않습니다.');
    const actor = room.players.get(actorId);
    assertProtocol(
      actor?.connected && (actor.isHost || actor.isModerator),
      'FORBIDDEN',
      '호스트 또는 진행자만 AI를 추가할 수 있습니다.'
    );
    const freeSeats = ROOM_CAPACITY - room.players.size;
    assertProtocol(freeSeats > 0, 'ROOM_FULL', '빈 자리가 없습니다.');

    const added = Math.min(count, freeSeats);
    const used = new Set([...room.players.values()].map((player) => player.nickname));
    for (let index = 0; index < added; index += 1) {
      const nickname = pickAiNickname(used);
      used.add(nickname);
      // AI는 재접속할 일이 없지만, 세션 토큰 해시 자리를 비워 두면 강퇴 목록
      // 대조에서 사람 참여자와 우연히 겹칠 수 있어 무작위 값을 넣어 둔다.
      const player = createPlayer(nickname, hashSessionToken(randomUUID()), false, false, true);
      room.players.set(player.playerId, player);
    }
    room.roomVersion += 1;
    room.eventSeq += 1;
    this.roomService.publishState(room);
    return added;
  }

  /** AI 참여자를 내보낸다. 사람은 이 경로로 내보낼 수 없다. */
  removePlayer(room: RoomRuntime, actorId: string, targetPlayerId: string): void {
    const actor = room.players.get(actorId);
    assertProtocol(
      actor?.connected && (actor.isHost || actor.isModerator),
      'FORBIDDEN',
      '호스트 또는 진행자만 AI를 내보낼 수 있습니다.'
    );
    const target = room.players.get(targetPlayerId);
    assertProtocol(target?.isAI, 'AI_NOT_FOUND', 'AI 참여자가 아닙니다.');
    room.players.delete(targetPlayerId);
    this.state(room.roomCode).guessers.delete(targetPlayerId);
    // 그릴 차례를 기다리던 AI가 빠지면 순환 순서에서도 지워야 차례가 비지 않는다.
    room.rotationPlayerIds = room.rotationPlayerIds.filter((id) => id !== targetPlayerId);
    if (room.drawerId === targetPlayerId) {
      // 그리던 AI가 빠지면 사람 강퇴와 같은 방식으로 권한을 넘긴다. 남은 획을
      // 이어 그리려면 제시어를 알아야 하므로 넘겨받은 사람에게 공개한다.
      const successor = room.moderatorId ?? room.hostId;
      room.drawerId = successor;
      room.round.drawing.drawerEpoch += 1;
      if (room.round.hasKeyword) room.round.keywordExposedPlayerIds.add(successor);
    }
    room.roomVersion += 1;
    room.eventSeq += 1;
    this.roomService.publishState(room);
  }

  // ───────────────────────────── 진행 훅 ─────────────────────────────

  /**
   * 방 상태가 바뀔 때마다 불린다. 여기서는 판단만 하고, 실제 API 호출은 큐 밖에서
   * 돌린다. 방 큐 안에서 네트워크를 기다리면 그동안 방 전체가 멈춘다.
   */
  onRoomChanged(room: RoomRuntime): void {
    if (!this.isAvailable()) return;
    if (room.status === 'CLOSED') {
      this.forgetRoom(room.roomCode);
      return;
    }
    const hasAi = [...room.players.values()].some((player) => player.isAI);
    if (!hasAi) return;

    const drawer = room.players.get(room.drawerId);
    const state = this.state(room.roomCode);

    // 1) AI가 그릴 차례인데 제시어를 아직 안 골랐다면 고른다.
    const canPrepare = room.round.status === 'PREPARING_KEYWORD' ||
      room.round.status === 'SOLVED' ||
      room.round.status === 'EXPIRED';
    if (drawer?.isAI && canPrepare && room.status !== 'RESULTS' &&
        state.startingRoundId !== room.round.roundId) {
      state.startingRoundId = room.round.roundId;
      this.later(room.roomCode, 1200, () => this.startRoundAsAi(room.roomCode, room.round.roundId));
      return;
    }

    // 2) AI가 그리는 라운드가 막 시작됐다면 그림을 그린다.
    if (drawer?.isAI && room.round.status === 'DRAWING_AND_GUESSING' &&
        state.drawnRoundId !== room.round.roundId) {
      state.drawnRoundId = room.round.roundId;
      void this.drawAsAi(room.roomCode, room.round.roundId, room.round.keyword ?? '');
    }

    // 3) 라운드가 돌아가는 중이면 AI 추측자들을 깨운다.
    if (room.round.status === 'DRAWING_AND_GUESSING') {
      for (const player of room.players.values()) {
        if (!player.isAI || player.playerId === room.drawerId) continue;
        if (room.round.keywordExposedPlayerIds.has(player.playerId)) continue;
        if (room.round.correctPlayerIds.has(player.playerId)) continue;
        if (state.guessers.has(player.playerId)) continue;
        state.guessers.set(player.playerId, { inFlight: false, rejected: [] });
        // 전부 동시에 답하면 티가 나므로 조금씩 어긋나게 첫 추측을 잡는다.
        const jitter = Math.floor(Math.random() * 4000);
        this.later(room.roomCode, AI_FIRST_GUESS_DELAY_MS + jitter, () => {
          void this.guessAsAi(room.roomCode, room.round.roundId, player.playerId);
        });
      }
      return;
    }

    // 라운드가 끝났으면 추측 상태를 비워 다음 라운드에 새로 시작하게 한다.
    state.guessers.clear();
  }

  // ───────────────────────────── 그리기 ─────────────────────────────

  /** AI 그리기 담당자가 제시어를 고르고 라운드를 시작한다. */
  private async startRoundAsAi(roomCode: string, roundId: string): Promise<void> {
    const room = this.peek(roomCode);
    if (!room || room.round.roundId !== roundId) return;
    // 서버가 이미 뽑아 둔 추천 제시어를 그대로 쓴다. AI에게 새로 짓게 하면
    // 키워드 목록에 없는 말이 나와 사람 참여자만 손해를 본다.
    const keyword = room.suggestedKeyword;
    try {
      await room.queue.enqueue(() => {
        const current = this.peek(roomCode);
        if (!current || current.round.roundId !== roundId) return;
        if (current.drawerId !== room.drawerId) return;
        this.gameService.startRound(current, current.drawerId, roundId, keyword);
      });
    } catch {
      // 사람이 먼저 시작했거나 인원이 모자란 경우다. 다음 상태 변화 때 다시 본다.
      this.state(roomCode).startingRoundId = null;
    }
  }

  /** 제시어를 받아 그림을 계획하고, 사람이 그리듯 한 배치씩 흘려보낸다. */
  private async drawAsAi(roomCode: string, roundId: string, keyword: string): Promise<void> {
    const provider = getProvider();
    if (!provider || !keyword) return;
    let plan: PlannedStroke[];
    try {
      plan = await planDrawing(provider, keyword);
    } catch {
      plan = [];
    }
    if (plan.length === 0) return;

    const room = this.peek(roomCode);
    if (!room || room.round.roundId !== roundId) return;
    const drawerId = room.drawerId;
    const drawerEpoch = room.round.drawing.drawerEpoch;
    const drawingRevision = room.round.drawing.drawingRevision;

    let delay = 0;
    for (const stroke of plan) {
      const strokeId = randomUUID();
      // 한 배치에 담을 수 있는 점 수가 정해져 있어 긴 획은 나눠 보낸다.
      const chunks: Array<{ points: typeof stroke.points; isFinal: boolean }> = [];
      for (let index = 0; index < stroke.points.length; index += MAX_POINTS_PER_BATCH) {
        const points = stroke.points.slice(index, index + MAX_POINTS_PER_BATCH);
        chunks.push({ points, isFinal: index + MAX_POINTS_PER_BATCH >= stroke.points.length });
      }
      chunks.forEach((chunk, batchSeq) => {
        delay += AI_STROKE_INTERVAL_MS;
        this.later(roomCode, delay, () => {
          const payload: StrokeBatchPayload = {
            roundId,
            drawingRevision,
            drawerEpoch,
            strokeId,
            batchSeq,
            isFinal: chunk.isFinal,
            tool: 'PEN',
            color: stroke.color,
            width: stroke.width,
            points: chunk.points
          };
          void room.queue.enqueue(() => {
            const current = this.peek(roomCode);
            if (!current || current.round.roundId !== roundId) return;
            if (current.drawerId !== drawerId) return;
            if (current.round.status !== 'DRAWING_AND_GUESSING') return;
            try {
              this.drawingService.draw(current, drawerId, payload, null);
            } catch {
              // 라운드가 먼저 끝났거나 캔버스가 지워진 것이다. 남은 획은 다음
              // 타이머에서 같은 조건에 걸려 조용히 사라진다.
            }
          });
        });
      });
    }
  }

  // ───────────────────────────── 추측 ─────────────────────────────

  /** AI 추측자가 캔버스를 한 번 보고 한 번 답한다. 그리고 다음 차례를 잡는다. */
  private async guessAsAi(roomCode: string, roundId: string, playerId: string): Promise<void> {
    const provider = getProvider();
    const room = this.peek(roomCode);
    if (!provider || !room || room.round.roundId !== roundId) return;
    if (room.round.status !== 'DRAWING_AND_GUESSING') return;
    const player = room.players.get(playerId);
    if (!player?.isAI) return;
    if (room.round.correctPlayerIds.has(playerId)) return;

    const tracker = this.state(roomCode).guessers.get(playerId);
    if (!tracker || tracker.inFlight) return;
    // 한도에 걸린 직후면 두드려 봐야 또 막힌다. 쉬었다가 다시 본다.
    if (isCoolingDown()) {
      this.scheduleNextGuess(roomCode, roundId, playerId);
      return;
    }
    // 아직 아무것도 안 그려졌으면 볼 것이 없다. 다음 차례에 다시 본다.
    const visible = room.round.drawing.strokes.filter((stroke) => !stroke.undone);
    if (visible.length === 0) {
      this.scheduleNextGuess(roomCode, roundId, playerId);
      return;
    }

    tracker.inFlight = true;
    let guess: string | null = null;
    try {
      guess = await guessDrawing(provider, visible, tracker.rejected);
    } catch {
      guess = null;
    }
    tracker.inFlight = false;

    if (guess && !tracker.rejected.includes(guess)) {
      // 같은 답을 반복하지 않도록 기억해 둔다. 맞았다면 어차피 더 묻지 않는다.
      tracker.rejected.push(guess);
      if (tracker.rejected.length > 8) tracker.rejected.shift();
      await room.queue.enqueue(() => {
        const current = this.peek(roomCode);
        if (!current || current.round.roundId !== roundId) return;
        if (current.round.status !== 'DRAWING_AND_GUESSING') return;
        try {
          this.gameService.submitGuess(
            current,
            playerId,
            { roundId, guessId: randomUUID(), text: guess! },
            null
          );
        } catch {
          // 시간이 끝났거나 이미 맞힌 경우다. 조용히 넘긴다.
        }
      });
    }
    this.scheduleNextGuess(roomCode, roundId, playerId);
  }

  private scheduleNextGuess(roomCode: string, roundId: string, playerId: string): void {
    const jitter = Math.floor(Math.random() * 3000);
    this.later(roomCode, getAiConfig().guessIntervalMs + jitter, () => {
      void this.guessAsAi(roomCode, roundId, playerId);
    });
  }

  /** 방이 이미 사라졌을 수 있다. 없으면 null. */
  private peek(roomCode: string): RoomRuntime | null {
    try {
      return this.registry.get(roomCode);
    } catch (error) {
      if (error instanceof ProtocolError) {
        this.forgetRoom(roomCode);
        return null;
      }
      throw error;
    }
  }
}
