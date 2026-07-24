import { randomInt, randomUUID } from 'node:crypto';
import {
  DEFAULT_DURATION_SECONDS,
  ROOM_CAPACITY,
  ROOM_CODE_MAX,
  ROOM_CODE_MIN,
  type RoomMode
} from '../../../shared/src/index.js';
import { ProtocolError } from '../protocol/errors.js';
import { RoomCommandQueue } from './roomCommandQueue.js';
import type { Player, RoomRuntime } from './types.js';

const emptyDrawing = (revision = 0, drawerEpoch = 0) => ({
  drawingRevision: revision,
  drawingSeq: 0,
  drawerEpoch,
  strokes: [],
  strokeCount: 0,
  pointCount: 0,
  serializedBytes: 0,
  acceptedBatches: new Map<string, unknown>()
});

const emptyRound = (roundNumber = 1, revision = 0, drawerEpoch = 0) => ({
  roundId: randomUUID(),
  roundNumber,
  status: 'PREPARING_KEYWORD' as const,
  hasKeyword: false,
  keyword: null,
  normalizedKeyword: null,
  keywordExposedPlayerIds: new Set<string>(),
  correctPlayerIds: new Set<string>(),
  drawerScored: false,
  startedAt: null,
  roundEndsAt: null,
  winnerId: null,
  winnerNickname: null,
  solvedAt: null,
  expiredAt: null,
  lastRoundEventId: null,
  guessSeq: 0,
  guessLocked: true,
  drawingLocked: true,
  drawing: emptyDrawing(revision, drawerEpoch)
});

export class RoomRegistry {
  readonly rooms = new Map<string, RoomRuntime>();

  private allocateCode(): string {
    if (this.rooms.size >= ROOM_CODE_MAX - ROOM_CODE_MIN + 1) {
      throw new ProtocolError('ROOM_CODE_EXHAUSTED', '사용 가능한 방번호가 없습니다.');
    }
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate = String(randomInt(ROOM_CODE_MIN, ROOM_CODE_MAX + 1));
      if (!this.rooms.has(candidate)) return candidate;
    }
    for (let code = ROOM_CODE_MIN; code <= ROOM_CODE_MAX; code += 1) {
      if (!this.rooms.has(String(code))) return String(code);
    }
    throw new ProtocolError('ROOM_CODE_EXHAUSTED', '사용 가능한 방번호가 없습니다.');
  }

  create(mode: RoomMode, host: Player): RoomRuntime {
    const roomCode = this.allocateCode();
    const room: RoomRuntime = {
      roomCode,
      mode,
      answerMode: 'UNTIL_TIMER',
      status: 'WAITING',
      roomVersion: 1,
      eventSeq: 0,
      capacity: ROOM_CAPACITY,
      hostId: host.playerId,
      moderatorId: mode === 'MODERATOR' ? host.playerId : null,
      drawerId: host.playerId,
      durationSeconds: DEFAULT_DURATION_SECONDS,
      players: new Map([[host.playerId, host]]),
      round: emptyRound(),
      guessFeed: [],
      kickedNicknames: new Set(),
      kickedSessionTokenHashes: new Set(),
      hostDisconnectedAt: null,
      expiresAt: null,
      createdAt: Date.now(),
      connections: new Map(),
      queue: new RoomCommandQueue(),
      roundTimer: null,
      hostTimer: null
    };
    this.rooms.set(roomCode, room);
    return room;
  }

  get(roomCode: string): RoomRuntime {
    const room = this.rooms.get(roomCode);
    if (!room || room.status === 'CLOSED') {
      throw new ProtocolError('ROOM_NOT_FOUND', '방을 찾을 수 없습니다.');
    }
    return room;
  }

  nextRound(room: RoomRuntime): void {
    room.round = emptyRound(
      room.round.roundNumber + 1,
      room.round.drawing.drawingRevision + 1,
      room.round.drawing.drawerEpoch
    );
    room.guessFeed = [];
    room.status = 'WAITING';
  }

  delete(roomCode: string): void {
    this.rooms.delete(roomCode);
  }
}
