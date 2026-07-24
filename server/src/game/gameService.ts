import { randomUUID } from 'node:crypto';
import type {
  AnswerMode,
  DrawerOrderMode,
  GuessPublic
} from '../../../shared/src/index.js';
import { broadcast, envelope, sendEnvelope } from '../broadcast/roomBroadcast.js';
import { ProtocolError, assertProtocol } from '../protocol/errors.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import { RoomService } from '../rooms/roomService.js';
import type { ClientConnection, RoomRuntime } from '../rooms/types.js';
import { assertPreparing, assertRound } from './gameStateMachine.js';
import { normalizeGuess, pickRandomKeyword } from './keywordService.js';
import { canStartRound } from './permissionService.js';
import { cancelRoundTimer } from './roundTimer.js';

export class GameService {
  constructor(
    private readonly registry: RoomRegistry,
    private readonly roomService: RoomService
  ) {}

  setDuration(room: RoomRuntime, actorId: string, durationSeconds: number): void {
    assertPreparing(room);
    const actor = room.players.get(actorId);
    assertProtocol(actor && (actor.isHost || actor.isModerator), 'FORBIDDEN', '시간 설정 권한이 없습니다.');
    assertProtocol(
      Number.isInteger(durationSeconds) &&
      durationSeconds >= 20 &&
      durationSeconds <= 180 &&
      durationSeconds % 5 === 0,
      'INVALID_DURATION',
      '제한 시간은 20~180초 사이의 5초 단위여야 합니다.'
    );
    room.durationSeconds = durationSeconds;
    room.roomVersion += 1;
    room.eventSeq += 1;
    this.roomService.publishState(room);
  }

  setAnswerMode(room: RoomRuntime, actorId: string, answerMode: AnswerMode): void {
    assertPreparing(room);
    const actor = room.players.get(actorId);
    assertProtocol(actor && (actor.isHost || actor.isModerator), 'FORBIDDEN', '정답 모드 설정 권한이 없습니다.');
    room.answerMode = answerMode;
    room.roomVersion += 1;
    room.eventSeq += 1;
    this.roomService.publishState(room);
  }

  setDrawerOrder(
    room: RoomRuntime,
    actorId: string,
    drawerOrderMode: DrawerOrderMode,
    rotationLaps: number
  ): void {
    assertPreparing(room);
    const actor = room.players.get(actorId);
    assertProtocol(actor && (actor.isHost || actor.isModerator), 'FORBIDDEN', '그리기 순서 설정 권한이 없습니다.');
    assertProtocol(room.rotationPlayerIds.length === 0, 'INVALID_PHASE', '진행 중인 순환 순서는 바꿀 수 없습니다.');
    assertProtocol(
      Number.isInteger(rotationLaps) && rotationLaps >= 1 && rotationLaps <= 10,
      'INVALID_DURATION',
      '순환 바퀴 수는 1~10 사이여야 합니다.'
    );
    room.drawerOrderMode = drawerOrderMode;
    room.rotationLaps = rotationLaps;
    room.roomVersion += 1;
    room.eventSeq += 1;
    this.roomService.publishState(room);
  }

  shuffleKeyword(room: RoomRuntime, actorId: string): void {
    const canPrepareKeyword = room.round.status === 'PREPARING_KEYWORD' ||
      room.round.status === 'SOLVED' ||
      room.round.status === 'EXPIRED';
    assertProtocol(canPrepareKeyword, 'INVALID_PHASE', '지금은 제시어를 다시 뽑을 수 없습니다.');
    assertProtocol(room.drawerId === actorId, 'NOT_DRAWER', '현재 그리기 담당자만 제시어를 다시 뽑을 수 있습니다.');
    room.lastSuggestedKeyword = room.suggestedKeyword;
    room.suggestedKeyword = pickRandomKeyword(room.lastSuggestedKeyword);
    room.roomVersion += 1;
    room.eventSeq += 1;
    this.roomService.publishState(room);
  }

  startRound(room: RoomRuntime, actorId: string, roundId: string, keyword: string): void {
    assertRound(room, roundId);
    const continuingWithSameDrawer =
      room.round.status === 'SOLVED' || room.round.status === 'EXPIRED';
    if (!continuingWithSameDrawer) assertPreparing(room);
    assertProtocol(room.drawerId === actorId, 'NOT_DRAWER', '현재 그리기 담당자만 시작할 수 있습니다.');
    assertProtocol(canStartRound(room), 'MIN_PLAYERS', '추측할 참여자가 한 명 이상 필요합니다.');
    const normalizedKeyword = normalizeGuess(keyword);
    assertProtocol(normalizedKeyword.length > 0, 'INVALID_KEYWORD', '공백만 있는 제시어는 사용할 수 없습니다.');
    if (continuingWithSameDrawer) {
      cancelRoundTimer(room);
      this.registry.nextRound(room);
    }
    if (room.drawerOrderMode === 'ROTATE' && room.rotationPlayerIds.length === 0) {
      const players = [...room.players.values()]
        .filter((player) => player.connected)
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((player) => player.playerId);
      const drawerIndex = players.indexOf(room.drawerId);
      room.rotationPlayerIds = drawerIndex > 0
        ? [...players.slice(drawerIndex), ...players.slice(0, drawerIndex)]
        : players;
      room.rotationTurnIndex = 0;
    }
    const startedAt = Date.now();
    room.round.keyword = keyword;
    room.round.normalizedKeyword = normalizedKeyword;
    room.round.hasKeyword = true;
    room.round.keywordExposedPlayerIds.add(room.drawerId);
    if (room.moderatorId) room.round.keywordExposedPlayerIds.add(room.moderatorId);
    room.round.startedAt = startedAt;
    room.round.roundEndsAt = startedAt + room.durationSeconds * 1000;
    room.round.guessLocked = false;
    room.round.drawingLocked = false;
    room.round.status = 'DRAWING_AND_GUESSING';
    room.status = 'ROUND_ACTIVE';
    room.roomVersion += 1;
    room.eventSeq += 1;
    this.scheduleExpiry(room, room.round.roundId);
    this.roomService.publishState(room);
  }

  private refreshSuggestedKeyword(room: RoomRuntime): void {
    room.lastSuggestedKeyword = room.round.keyword;
    room.suggestedKeyword = pickRandomKeyword(room.lastSuggestedKeyword);
  }

  private rankings(room: RoomRuntime): Array<{
    rank: number;
    playerId: string;
    nickname: string;
    score: number;
  }> {
    const sorted = [...room.players.values()].sort(
      (a, b) => b.score - a.score || a.joinedAt - b.joinedAt
    );
    let previousScore: number | null = null;
    let rank = 0;
    return sorted.map((player, index) => {
      if (player.score !== previousScore) rank = index + 1;
      previousScore = player.score;
      return {
        rank,
        playerId: player.playerId,
        nickname: player.nickname,
        score: player.score
      };
    });
  }

  private publishFreshRound(room: RoomRuntime): void {
    room.roomVersion += 1;
    room.eventSeq += 1;
    this.roomService.publishState(room);
    broadcast(room, envelope('DRAWING_CLEARED', {
      roundId: room.round.roundId,
      drawingRevision: room.round.drawing.drawingRevision,
      drawingSeq: 0
    }, {
      roomVersion: room.roomVersion,
      eventSeq: room.eventSeq,
      roundId: room.round.roundId
    }));
  }

  private advanceRotation(room: RoomRuntime): boolean {
    if (room.drawerOrderMode !== 'ROTATE' || room.rotationPlayerIds.length === 0) return false;
    const totalTurns = room.rotationPlayerIds.length * room.rotationLaps;
    let nextTurn = room.rotationTurnIndex + 1;
    while (nextTurn < totalTurns) {
      const nextPlayerId = room.rotationPlayerIds[nextTurn % room.rotationPlayerIds.length]!;
      if (room.players.get(nextPlayerId)?.connected) break;
      nextTurn += 1;
    }
    if (nextTurn >= totalTurns) {
      room.status = 'RESULTS';
      room.rotationTurnIndex = totalTurns - 1;
      room.finalRankings = this.rankings(room);
      room.roomVersion += 1;
      room.eventSeq += 1;
      this.roomService.publishState(room);
      return true;
    }
    room.rotationTurnIndex = nextTurn;
    this.registry.nextRound(room);
    room.drawerId = room.rotationPlayerIds[nextTurn % room.rotationPlayerIds.length]!;
    this.publishFreshRound(room);
    return true;
  }

  private scheduleExpiry(room: RoomRuntime, roundId: string): void {
    cancelRoundTimer(room);
    const remaining = Math.max(0, (room.round.roundEndsAt ?? Date.now()) - Date.now());
    room.roundTimer = setTimeout(() => {
      void room.queue.enqueue(() => this.expireRound(room, roundId));
    }, remaining);
    room.roundTimer.unref();
  }

  private finishTimedRound(room: RoomRuntime, roundId: string, endedAt: number): void {
    const roundEndsAt = room.round.roundEndsAt!;
    cancelRoundTimer(room);
    room.round.status = 'EXPIRED';
    room.status = 'ROUND_EXPIRED';
    room.round.expiredAt = endedAt;
    room.round.guessLocked = true;
    room.round.drawingLocked = true;
    room.round.lastRoundEventId = randomUUID();
    const eligibleGuessers = [...room.players.values()].filter((player) =>
      player.connected &&
      !player.isModerator &&
      !room.round.keywordExposedPlayerIds.has(player.playerId)
    );
    const everyoneAnsweredCorrectly = eligibleGuessers.length > 0 &&
      eligibleGuessers.every((player) => room.round.correctPlayerIds.has(player.playerId));
    this.refreshSuggestedKeyword(room);
    room.roomVersion += 1;
    room.eventSeq += 1;
    broadcast(room, envelope('ROUND_EXPIRED', {
      eventId: room.round.lastRoundEventId,
      roundId,
      expiredAt: endedAt,
      roundEndsAt,
      answerMode: room.answerMode,
      correctCount: room.round.correctPlayerIds.size,
      answerText: everyoneAnsweredCorrectly ? null : room.round.keyword
    }, {
      roomVersion: room.roomVersion,
      eventSeq: room.eventSeq,
      roundId
    }));
    if (this.advanceRotation(room)) return;
    this.roomService.publishState(room);
  }

  expireRound(room: RoomRuntime, roundId: string, now = Date.now()): boolean {
    if (room.round.roundId !== roundId || room.round.status !== 'DRAWING_AND_GUESSING') return false;
    const roundEndsAt = room.round.roundEndsAt;
    if (roundEndsAt === null) return false;
    if (now < roundEndsAt) {
      this.scheduleExpiry(room, roundId);
      return false;
    }
    this.finishTimedRound(room, roundId, now);
    return true;
  }

  ensureActiveBeforeDeadline(room: RoomRuntime, roundId: string, now = Date.now()): void {
    assertRound(room, roundId);
    if (room.round.status === 'SOLVED' || room.round.status === 'EXPIRED') {
      throw new ProtocolError('ROUND_LOCKED', '종료된 라운드입니다.');
    }
    assertProtocol(room.round.status === 'DRAWING_AND_GUESSING', 'INVALID_PHASE', '진행 중인 라운드가 아닙니다.');
    if (room.round.roundEndsAt !== null && now >= room.round.roundEndsAt) {
      this.expireRound(room, roundId, now);
      throw new ProtocolError('ROUND_EXPIRED', '제한 시간이 종료되었습니다.');
    }
  }

  submitGuess(
    room: RoomRuntime,
    actorId: string,
    payload: { roundId: string; guessId: string; text: string },
    connection: ClientConnection
  ): void {
    this.ensureActiveBeforeDeadline(room, payload.roundId);
    assertProtocol(!room.round.guessLocked, 'ROUND_LOCKED', '추측 입력이 잠겼습니다.');
    const actor = room.players.get(actorId);
    assertProtocol(actor?.connected, 'NOT_IN_ROOM', '방에 연결되어 있지 않습니다.');
    assertProtocol(
      !actor.isModerator && !room.round.keywordExposedPlayerIds.has(actorId),
      'GUESS_FORBIDDEN',
      '제시어를 본 참여자는 추측할 수 없습니다.'
    );

    const duplicate = room.guessFeed.find((guess) => guess.guessId === payload.guessId);
    if (duplicate) {
      sendEnvelope(connection, envelope('GUESS_SHARED', duplicate, {
        roomVersion: room.roomVersion,
        eventSeq: room.eventSeq,
        roundId: room.round.roundId
      }));
      return;
    }
    assertProtocol(
      !room.round.correctPlayerIds.has(actorId),
      'GUESS_FORBIDDEN',
      '이미 정답을 맞힌 라운드입니다.'
    );

    room.round.guessSeq += 1;
    const isCorrect = normalizeGuess(payload.text) === room.round.normalizedKeyword;
    const guess: GuessPublic = {
      guessId: payload.guessId,
      roundId: payload.roundId,
      guessSeq: room.round.guessSeq,
      playerId: actorId,
      nickname: actor.nickname,
      text: isCorrect && room.answerMode === 'UNTIL_TIMER' ? null : payload.text,
      submittedAt: Date.now(),
      isCorrect
    };
    room.guessFeed.push(guess);
    if (room.guessFeed.length > 100) room.guessFeed.shift();
    room.eventSeq += 1;
    broadcast(room, envelope('GUESS_SHARED', guess, {
      roomVersion: room.roomVersion,
      eventSeq: room.eventSeq,
      roundId: room.round.roundId
    }));

    if (!isCorrect) return;
    const participantCount = [...room.players.values()].filter((player) => player.connected).length;
    const correctRank = room.round.correctPlayerIds.size + 1;
    room.round.correctPlayerIds.add(actorId);
    actor.score += Math.max(1, participantCount - correctRank + 1);
    const drawer = room.players.get(room.drawerId);
    if (drawer) drawer.score += 1;
    room.roomVersion += 1;

    if (room.answerMode === 'UNTIL_TIMER') {
      const eligibleGuessers = [...room.players.values()].filter((player) =>
        player.connected &&
        !player.isModerator &&
        !room.round.keywordExposedPlayerIds.has(player.playerId)
      );
      if (eligibleGuessers.length > 0 && eligibleGuessers.every((player) =>
        room.round.correctPlayerIds.has(player.playerId)
      )) {
        this.finishTimedRound(room, payload.roundId, Date.now());
        return;
      }
      this.roomService.publishState(room);
      return;
    }

    cancelRoundTimer(room);
    room.round.status = 'SOLVED';
    room.status = 'ROUND_SOLVED';
    room.round.winnerId = actorId;
    room.round.winnerNickname = actor.nickname;
    room.round.solvedAt = Date.now();
    room.round.guessLocked = true;
    room.round.drawingLocked = true;
    room.round.lastRoundEventId = randomUUID();
    const eligibleGuessers = [...room.players.values()].filter((player) =>
      player.connected &&
      !player.isModerator &&
      !room.round.keywordExposedPlayerIds.has(player.playerId)
    );
    const everyoneAnsweredCorrectly = eligibleGuessers.length > 0 &&
      eligibleGuessers.every((player) => room.round.correctPlayerIds.has(player.playerId));
    broadcast(room, envelope('ROUND_SOLVED', {
      eventId: room.round.lastRoundEventId,
      roundId: room.round.roundId,
      guessId: guess.guessId,
      guessSeq: guess.guessSeq,
      winnerId: actorId,
      winnerNickname: actor.nickname,
      answerText: everyoneAnsweredCorrectly ? null : room.round.keyword,
      solvedAt: room.round.solvedAt
    }, {
      roomVersion: room.roomVersion,
      eventSeq: room.eventSeq,
      roundId: room.round.roundId
    }));
    this.refreshSuggestedKeyword(room);
    if (this.advanceRotation(room)) return;
    this.roomService.publishState(room);
  }

  assignDrawer(room: RoomRuntime, actorId: string, targetPlayerId: string): void {
    const actor = room.players.get(actorId);
    const preparing = room.round.status === 'PREPARING_KEYWORD';
    const activeModerator = room.round.status === 'DRAWING_AND_GUESSING' &&
      room.mode === 'MODERATOR' && actor?.isModerator;
    assertProtocol(preparing || activeModerator, 'INVALID_PHASE', '현재 단계에서는 그리기 담당자를 바꿀 수 없습니다.');
    assertProtocol(
      actor?.connected && (preparing ? actor.isHost || actor.isModerator : actor.isModerator),
      'FORBIDDEN',
      '그리기 담당자 지정 권한이 없습니다.'
    );
    const target = room.players.get(targetPlayerId);
    assertProtocol(target, 'TARGET_NOT_FOUND', '대상 참여자를 찾을 수 없습니다.');
    assertProtocol(target.connected, 'TARGET_DISCONNECTED', '연결된 참여자만 지정할 수 있습니다.');
    assertProtocol(
      !target.isModerator && (preparing || !target.isHost),
      'FORBIDDEN',
      '현재 선택할 수 없는 참여자입니다.'
    );
    room.drawerId = targetPlayerId;
    room.round.drawing.drawerEpoch += 1;
    if (room.round.hasKeyword) room.round.keywordExposedPlayerIds.add(targetPlayerId);
    room.roomVersion += 1;
    room.eventSeq += 1;
    this.roomService.publishState(room);
  }

  reclaimDrawer(room: RoomRuntime, actorId: string): void {
    const actor = room.players.get(actorId);
    const preparing = room.round.status === 'PREPARING_KEYWORD';
    const activeModerator = room.round.status === 'DRAWING_AND_GUESSING' &&
      room.mode === 'MODERATOR' && actor?.isModerator;
    assertProtocol(preparing || activeModerator, 'INVALID_PHASE', '현재 단계에서는 그리기 권한을 회수할 수 없습니다.');
    assertProtocol(
      actor?.connected && (preparing ? actor.isHost || actor.isModerator : actor.isModerator),
      'FORBIDDEN',
      '그리기 권한 회수 권한이 없습니다.'
    );
    if (room.drawerId === actorId) return;
    room.drawerId = actorId;
    room.round.drawing.drawerEpoch += 1;
    if (room.round.hasKeyword) room.round.keywordExposedPlayerIds.add(actorId);
    room.roomVersion += 1;
    room.eventSeq += 1;
    this.roomService.publishState(room);
  }

  startNextRound(room: RoomRuntime, actorId: string, previousRoundId: string): void {
    assertRound(room, previousRoundId);
    assertProtocol(
      room.round.status === 'SOLVED' || room.round.status === 'EXPIRED',
      'INVALID_PHASE',
      '종료된 라운드에서만 다음 라운드를 준비할 수 있습니다.'
    );
    const actor = room.players.get(actorId);
    const permitted = room.mode === 'NORMAL' ? actor?.isHost : actor?.isModerator;
    assertProtocol(permitted, 'FORBIDDEN', '다음 라운드 권한이 없습니다.');
    assertProtocol(room.drawerOrderMode === 'FIXED', 'INVALID_PHASE', '순환 그리기는 다음 차례가 자동으로 준비됩니다.');
    this.prepareWaitingRoom(room);
  }

  returnToWaiting(room: RoomRuntime, actorId: string, roundId: string): void {
    assertRound(room, roundId);
    assertProtocol(
      room.round.status !== 'PREPARING_KEYWORD',
      'INVALID_PHASE',
      '이미 대기실에 있습니다.'
    );
    const actor = room.players.get(actorId);
    assertProtocol(
      actor?.connected && (actor.isHost || actor.isModerator),
      'FORBIDDEN',
      '대기실로 돌아갈 권한이 없습니다.'
    );
    this.prepareWaitingRoom(room);
  }

  private prepareWaitingRoom(room: RoomRuntime): void {
    cancelRoundTimer(room);
    room.rotationPlayerIds = [];
    room.rotationTurnIndex = 0;
    room.finalRankings = null;
    this.registry.nextRound(room);
    this.publishFreshRound(room);
  }

  endCeremony(room: RoomRuntime, actorId: string): void {
    assertProtocol(room.status === 'RESULTS', 'INVALID_PHASE', '시상식 진행 중이 아닙니다.');
    const actor = room.players.get(actorId);
    assertProtocol(
      actor?.connected && (actor.isHost || actor.isModerator),
      'FORBIDDEN',
      '시상식을 종료할 권한이 없습니다.'
    );
    for (const player of room.players.values()) player.score = 0;
    room.rotationPlayerIds = [];
    room.rotationTurnIndex = 0;
    room.finalRankings = null;
    const nextDrawer = room.players.get(room.hostId)?.connected
      ? room.hostId
      : [...room.players.values()].find((player) => player.connected)?.playerId;
    if (nextDrawer) room.drawerId = nextDrawer;
    this.registry.nextRound(room);
    this.publishFreshRound(room);
  }
}
