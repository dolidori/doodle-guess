import {
  MAX_CLIENT_MESSAGE_BYTES,
  type ClientPayloadMap
} from '../../../shared/src/index.js';
import { AiService } from '../ai/aiService.js';
import { passwordMatches } from '../ai/auth.js';
import { getAiConfig } from '../ai/config.js';
import { envelope, sendEnvelope } from '../broadcast/roomBroadcast.js';
import { DrawingService } from '../drawing/drawingService.js';
import { GameService } from '../game/gameService.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import { RoomService } from '../rooms/roomService.js';
import type { ClientConnection, RoomRuntime } from '../rooms/types.js';
import { ProtocolError } from './errors.js';
import { RateLimiter } from './rateLimit.js';
import { parseCommand, PayloadValidationError } from './schemas.js';

const EVENT_MAX_BYTES: Record<string, number> = {
  CREATE_ROOM: 2048,
  JOIN_ROOM: 2048,
  LEAVE_ROOM: 1024,
  SET_ROUND_DURATION: 1024,
  SET_ANSWER_MODE: 1024,
  SET_DRAWER_ORDER: 1024,
  SHUFFLE_KEYWORD: 1024,
  SET_KEYWORD_AND_START: 1024,
  SUBMIT_GUESS: 1024,
  DRAW_STROKE_BATCH: 8192,
  UNDO_LAST_STROKE: 1024,
  CLEAR_DRAWING: 1024,
  ASSIGN_DRAWER: 1024,
  RECLAIM_DRAWER: 1024,
  KICK_PLAYER: 1024,
  START_NEXT_ROUND: 1024,
  RETURN_TO_WAITING: 1024,
  END_CEREMONY: 1024,
  AI_LOGIN: 1024,
  ADD_AI_PLAYER: 1024,
  REMOVE_AI_PLAYER: 1024
};

export class Dispatcher {
  private readonly limiter = new RateLimiter();
  readonly roomService: RoomService;
  readonly gameService: GameService;
  readonly drawingService: DrawingService;
  readonly aiService: AiService;

  constructor(readonly registry: RoomRegistry) {
    this.roomService = new RoomService(registry);
    this.gameService = new GameService(registry, this.roomService);
    this.drawingService = new DrawingService(this.gameService, this.roomService);
    this.aiService = new AiService(
      registry,
      this.roomService,
      this.gameService,
      this.drawingService
    );
    this.roomService.onStateChanged = (room) => this.aiService.onRoomChanged(room);
  }

  /**
   * AI 로그인은 방에 들어가기 전(로비)에서도 받아야 해서 방 명령과 따로 처리한다.
   * 성공하면 이 연결에 표시를 남기고, 이후 같은 연결에서만 AI를 추가할 수 있다.
   */
  private handleAiLogin(connection: ClientConnection, password: string, requestId: string): void {
    const config = getAiConfig();
    const available = this.aiService.isAvailable();
    if (!available) {
      sendEnvelope(connection, envelope('AI_SESSION', {
        authorized: false,
        available: false,
        message: '이 서버에는 AI가 설정되어 있지 않습니다.'
      }, { requestId }));
      return;
    }
    const authorized = passwordMatches(password, config.password);
    connection.aiAuthorized = authorized;
    sendEnvelope(connection, envelope('AI_SESSION', {
      authorized,
      available: true,
      message: authorized ? 'AI 참여자를 추가할 수 있습니다.' : '비밀번호가 올바르지 않습니다.'
    }, { requestId }));
  }

  private sendError(
    connection: ClientConnection,
    requestId: string | undefined,
    error: ProtocolError
  ): void {
    sendEnvelope(connection, envelope('ERROR', error.toPayload(), {
      ...(requestId ? { requestId } : {})
    }));
  }

  async handle(connection: ClientConnection, raw: Buffer): Promise<void> {
    if (raw.byteLength > MAX_CLIENT_MESSAGE_BYTES) {
      connection.ws.close(1009, '메시지가 너무 큽니다.');
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(raw.toString('utf8'));
    } catch {
      this.sendError(connection, undefined, new ProtocolError('INVALID_JSON', 'JSON 형식이 아닙니다.'));
      return;
    }

    let command;
    try {
      command = parseCommand(input);
    } catch (error) {
      const requestId =
        typeof input === 'object' && input !== null && 'requestId' in input &&
        typeof input.requestId === 'string' ? input.requestId : undefined;
      const code = error instanceof PayloadValidationError ? 'INVALID_PAYLOAD' : 'INVALID_ENVELOPE';
      this.sendError(connection, requestId, new ProtocolError(code, '요청 형식이 올바르지 않습니다.'));
      return;
    }

    const now = Date.now();
    for (const [requestId, completedAt] of connection.processedRequestIds) {
      if (now - completedAt > 60_000) connection.processedRequestIds.delete(requestId);
    }
    if (connection.processedRequestIds.has(command.requestId)) return;

    const eventBytes = Buffer.byteLength(JSON.stringify(command), 'utf8');
    if (eventBytes > (EVENT_MAX_BYTES[command.type] ?? MAX_CLIENT_MESSAGE_BYTES)) {
      this.sendError(connection, command.requestId, new ProtocolError('PAYLOAD_TOO_LARGE', '이벤트 크기 제한을 넘었습니다.'));
      return;
    }
    const entering = command.type === 'CREATE_ROOM' || command.type === 'JOIN_ROOM';
    if (
      !this.limiter.take(`connection:${connection.id}`, command.type) ||
      (entering && !this.limiter.takeSharedIp(connection.ip, command.type))
    ) {
      this.sendError(connection, command.requestId, new ProtocolError('RATE_LIMITED', '요청이 너무 빠릅니다.'));
      return;
    }

    try {
      if (command.type === 'CREATE_ROOM') {
        const payload = command.payload as ClientPayloadMap['CREATE_ROOM'];
        this.roomService.create(payload.nickname, payload.mode, connection, command.requestId);
      } else if (command.type === 'AI_LOGIN') {
        const payload = command.payload as ClientPayloadMap['AI_LOGIN'];
        this.handleAiLogin(connection, payload.password, command.requestId);
      } else if (command.type === 'JOIN_ROOM') {
        const payload = command.payload as ClientPayloadMap['JOIN_ROOM'];
        const room = this.registry.get(payload.roomCode);
        await room.queue.enqueue(() => {
          const currentRoom = this.registry.get(payload.roomCode);
          this.roomService.join(
            currentRoom,
            payload.nickname,
            payload.sessionToken,
            connection,
            command.requestId
          );
        });
      } else {
        await this.dispatchRoomCommand(connection, command);
      }
      connection.processedRequestIds.set(command.requestId, Date.now());
    } catch (error) {
      this.sendError(
        connection,
        command.requestId,
        error instanceof ProtocolError
          ? error
          : new ProtocolError('INTERNAL_ERROR', '요청을 처리하지 못했습니다.')
      );
    }
  }

  private async dispatchRoomCommand(
    connection: ClientConnection,
    command: ReturnType<typeof parseCommand>
  ): Promise<void> {
    if (!connection.roomCode || !connection.playerId) {
      throw new ProtocolError('NOT_IN_ROOM', '방에 입장해 있지 않습니다.');
    }
    const room = this.registry.get(connection.roomCode);
    await room.queue.enqueue(() => {
      const currentRoom = this.registry.get(connection.roomCode!);
      const actorId = connection.playerId!;
      if (currentRoom.connections.get(actorId) !== connection) {
        throw new ProtocolError('NOT_IN_ROOM', '현재 연결은 방에 속하지 않습니다.');
      }
      this.execute(currentRoom, actorId, connection, command);
    });
  }

  private execute(
    room: RoomRuntime,
    actorId: string,
    connection: ClientConnection,
    command: ReturnType<typeof parseCommand>
  ): void {
    switch (command.type) {
      case 'LEAVE_ROOM':
        this.roomService.leave(room, actorId, connection);
        break;
      case 'SET_ROUND_DURATION':
        this.gameService.setDuration(
          room,
          actorId,
          (command.payload as ClientPayloadMap['SET_ROUND_DURATION']).durationSeconds
        );
        break;
      case 'SET_ANSWER_MODE':
        this.gameService.setAnswerMode(
          room,
          actorId,
          (command.payload as ClientPayloadMap['SET_ANSWER_MODE']).answerMode
        );
        break;
      case 'SET_DRAWER_ORDER': {
        const payload = command.payload as ClientPayloadMap['SET_DRAWER_ORDER'];
        this.gameService.setDrawerOrder(
          room,
          actorId,
          payload.drawerOrderMode,
          payload.rotationLaps
        );
        break;
      }
      case 'SHUFFLE_KEYWORD':
        this.gameService.shuffleKeyword(room, actorId);
        break;
      case 'SET_KEYWORD_AND_START': {
        const payload = command.payload as ClientPayloadMap['SET_KEYWORD_AND_START'];
        this.gameService.startRound(room, actorId, payload.roundId, payload.keyword);
        break;
      }
      case 'SUBMIT_GUESS':
        this.gameService.submitGuess(
          room,
          actorId,
          command.payload as ClientPayloadMap['SUBMIT_GUESS'],
          connection
        );
        break;
      case 'DRAW_STROKE_BATCH':
        this.drawingService.draw(
          room,
          actorId,
          command.payload as ClientPayloadMap['DRAW_STROKE_BATCH'],
          connection
        );
        break;
      case 'UNDO_LAST_STROKE':
        this.drawingService.undo(
          room,
          actorId,
          command.payload as ClientPayloadMap['UNDO_LAST_STROKE']
        );
        break;
      case 'CLEAR_DRAWING':
        this.drawingService.clear(
          room,
          actorId,
          command.payload as ClientPayloadMap['CLEAR_DRAWING']
        );
        break;
      case 'ASSIGN_DRAWER':
        this.gameService.assignDrawer(
          room,
          actorId,
          (command.payload as ClientPayloadMap['ASSIGN_DRAWER']).targetPlayerId
        );
        break;
      case 'RECLAIM_DRAWER':
        this.gameService.reclaimDrawer(room, actorId);
        break;
      case 'KICK_PLAYER':
        this.roomService.kick(
          room,
          actorId,
          (command.payload as ClientPayloadMap['KICK_PLAYER']).targetPlayerId
        );
        break;
      case 'START_NEXT_ROUND':
        this.gameService.startNextRound(
          room,
          actorId,
          (command.payload as ClientPayloadMap['START_NEXT_ROUND']).previousRoundId
        );
        break;
      case 'RETURN_TO_WAITING':
        this.gameService.returnToWaiting(
          room,
          actorId,
          (command.payload as ClientPayloadMap['RETURN_TO_WAITING']).roundId
        );
        break;
      case 'END_CEREMONY':
        this.gameService.endCeremony(room, actorId);
        break;
      case 'ADD_AI_PLAYER': {
        if (!connection.aiAuthorized) {
          throw new ProtocolError('AI_AUTH_REQUIRED', 'AI 비밀번호를 먼저 입력해 주세요.');
        }
        const payload = command.payload as ClientPayloadMap['ADD_AI_PLAYER'];
        this.aiService.addPlayers(room, actorId, payload.count);
        break;
      }
      case 'REMOVE_AI_PLAYER': {
        if (!connection.aiAuthorized) {
          throw new ProtocolError('AI_AUTH_REQUIRED', 'AI 비밀번호를 먼저 입력해 주세요.');
        }
        const payload = command.payload as ClientPayloadMap['REMOVE_AI_PLAYER'];
        this.aiService.removePlayer(room, actorId, payload.targetPlayerId);
        break;
      }
      default:
        throw new ProtocolError('INVALID_ENVELOPE', '알 수 없는 이벤트입니다.');
    }
  }
}
