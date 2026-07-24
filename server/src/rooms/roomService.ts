import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  HOST_ABSENCE_TTL_MS,
  ROOM_CAPACITY,
  type RoomMode
} from '../../../shared/src/index.js';
import { broadcast, envelope, sendEnvelope } from '../broadcast/roomBroadcast.js';
import { sendDrawingSnapshot } from '../drawing/snapshotService.js';
import { ProtocolError, assertProtocol } from '../protocol/errors.js';
import { buildPrivateState } from '../state/privateState.js';
import { buildPublicState } from '../state/publicState.js';
import type { ClientConnection, Player, RoomRuntime } from './types.js';
import { RoomRegistry } from './roomRegistry.js';

export const generateSessionToken = (): string => randomBytes(32).toString('base64url');
export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

const normalizedNickname = (nickname: string): string => nickname.trim();

export const createPlayer = (
  nickname: string,
  sessionTokenHash: string,
  isHost: boolean,
  isModerator: boolean
): Player => ({
  playerId: randomUUID(),
  nickname,
  normalizedNickname: normalizedNickname(nickname),
  sessionTokenHash,
  connected: true,
  isHost,
  isModerator,
  score: 0,
  joinedAt: Date.now(),
  disconnectedAt: null
});

export class RoomService {
  constructor(private readonly registry: RoomRegistry) {}

  private attach(room: RoomRuntime, player: Player, connection: ClientConnection): void {
    connection.roomCode = room.roomCode;
    connection.playerId = player.playerId;
    connection.explicitlyLeft = false;
    room.connections.set(player.playerId, connection);
  }

  private sendSession(
    room: RoomRuntime,
    player: Player,
    connection: ClientConnection,
    token: string,
    isReconnect: boolean,
    requestId: string
  ): void {
    sendEnvelope(connection, envelope('ROOM_SESSION', {
      roomCode: room.roomCode,
      playerId: player.playerId,
      nickname: player.nickname,
      mode: room.mode,
      sessionToken: token,
      isReconnect
    }, { requestId }));
  }

  publishState(room: RoomRuntime): void {
    const publicState = buildPublicState(room);
    broadcast(room, envelope('PUBLIC_STATE', publicState, {
      roomVersion: room.roomVersion,
      eventSeq: room.eventSeq,
      roundId: room.round.roundId
    }));
    for (const [playerId, connection] of room.connections) {
      const player = room.players.get(playerId);
      if (!player) continue;
      sendEnvelope(connection, envelope(
        'PRIVATE_STATE',
        buildPrivateState(room, player),
        { roomVersion: room.roomVersion, roundId: room.round.roundId }
      ));
    }
  }

  create(
    nickname: string,
    mode: RoomMode,
    connection: ClientConnection,
    requestId: string
  ): RoomRuntime {
    assertProtocol(connection.roomCode === null, 'ALREADY_IN_ROOM', '이미 방에 입장해 있습니다.');
    const token = generateSessionToken();
    const player = createPlayer(nickname, hashSessionToken(token), true, mode === 'MODERATOR');
    const room = this.registry.create(mode, player);
    this.attach(room, player, connection);
    this.sendSession(room, player, connection, token, false, requestId);
    this.publishState(room);
    sendDrawingSnapshot(room, connection);
    return room;
  }

  join(
    room: RoomRuntime,
    nickname: string,
    sessionToken: string | undefined,
    connection: ClientConnection,
    requestId: string
  ): void {
    assertProtocol(connection.roomCode === null, 'ALREADY_IN_ROOM', '이미 방에 입장해 있습니다.');
    const normalized = normalizedNickname(nickname);
    let player: Player | undefined;
    let isReconnect = false;

    if (sessionToken) {
      const hash = hashSessionToken(sessionToken);
      assertProtocol(!room.kickedSessionTokenHashes.has(hash), 'REENTRY_BLOCKED', '강퇴된 세션입니다.');
      const tokenPlayer = [...room.players.values()].find((candidate) => candidate.sessionTokenHash === hash);
      assertProtocol(tokenPlayer, 'INVALID_SESSION', '유효하지 않은 세션입니다.');
      assertProtocol(tokenPlayer.nickname === nickname, 'INVALID_SESSION', '세션과 닉네임이 일치하지 않습니다.');
      assertProtocol(!tokenPlayer.connected, 'SESSION_IN_USE', '이미 연결된 세션입니다.');
      player = tokenPlayer;
      isReconnect = true;
    } else {
      assertProtocol(!room.kickedNicknames.has(normalized), 'REENTRY_BLOCKED', '강퇴된 닉네임입니다.');
      const sameNickname = [...room.players.values()].find(
        (candidate) => candidate.normalizedNickname === normalized
      );
      if (sameNickname?.connected) {
        throw new ProtocolError('NICKNAME_IN_USE', '이미 사용 중인 닉네임입니다.');
      }
      if (sameNickname) {
        player = sameNickname;
        isReconnect = true;
      }
    }

    if (!player) {
      assertProtocol(room.players.size < ROOM_CAPACITY, 'ROOM_FULL', '방 정원이 가득 찼습니다.');
      const temporaryToken = generateSessionToken();
      player = createPlayer(nickname, hashSessionToken(temporaryToken), false, false);
      room.players.set(player.playerId, player);
    }

    const rotatedToken = generateSessionToken();
    player.sessionTokenHash = hashSessionToken(rotatedToken);
    player.connected = true;
    player.disconnectedAt = null;
    this.attach(room, player, connection);

    if (player.isHost) {
      if (room.hostTimer) clearTimeout(room.hostTimer);
      room.hostTimer = null;
      room.hostDisconnectedAt = null;
      room.expiresAt = null;
    }

    room.roomVersion += 1;
    room.eventSeq += 1;
    this.sendSession(room, player, connection, rotatedToken, isReconnect, requestId);
    this.publishState(room);
    sendDrawingSnapshot(room, connection);
  }

  disconnect(connection: ClientConnection): void {
    if (!connection.roomCode || !connection.playerId || connection.explicitlyLeft) return;
    const room = this.registry.rooms.get(connection.roomCode);
    if (!room || room.connections.get(connection.playerId) !== connection) return;
    void room.queue.enqueue(() => {
      if (room.connections.get(connection.playerId!) !== connection) return;
      room.connections.delete(connection.playerId!);
      const player = room.players.get(connection.playerId!);
      if (!player) return;
      player.connected = false;
      player.disconnectedAt = Date.now();
      room.roomVersion += 1;
      room.eventSeq += 1;
      if (player.isHost) this.scheduleHostExpiry(room);
      this.publishState(room);
    });
  }

  private scheduleHostExpiry(room: RoomRuntime): void {
    if (room.hostTimer) clearTimeout(room.hostTimer);
    room.hostDisconnectedAt = Date.now();
    room.expiresAt = room.hostDisconnectedAt + HOST_ABSENCE_TTL_MS;
    room.hostTimer = setTimeout(() => {
      void room.queue.enqueue(() => {
        const host = room.players.get(room.hostId);
        if (host?.connected || room.expiresAt === null || Date.now() < room.expiresAt) return;
        this.closeRoom(room, 'HOST_ABSENT_TIMEOUT');
      });
    }, HOST_ABSENCE_TTL_MS);
    room.hostTimer.unref();
  }

  leave(room: RoomRuntime, actorId: string, connection: ClientConnection): void {
    const actor = room.players.get(actorId);
    assertProtocol(actor?.connected, 'NOT_IN_ROOM', '방에 입장해 있지 않습니다.');
    connection.explicitlyLeft = true;
    if (actor.isHost) {
      this.closeRoom(room, 'HOST_LEFT');
      return;
    }
    room.connections.delete(actorId);
    room.players.delete(actorId);
    connection.roomCode = null;
    connection.playerId = null;
    room.roomVersion += 1;
    room.eventSeq += 1;
    this.publishState(room);
  }

  kick(room: RoomRuntime, actorId: string, targetPlayerId: string): void {
    const actor = room.players.get(actorId);
    const target = room.players.get(targetPlayerId);
    assertProtocol(actor && (actor.isHost || actor.isModerator), 'FORBIDDEN', '강퇴 권한이 없습니다.');
    assertProtocol(target, 'TARGET_NOT_FOUND', '대상 참여자를 찾을 수 없습니다.');
    assertProtocol(!target.isHost && !target.isModerator, 'CANNOT_KICK_PRIVILEGED', '호스트나 진행자는 강퇴할 수 없습니다.');
    assertProtocol(target.playerId !== actorId, 'FORBIDDEN', '자신을 강퇴할 수 없습니다.');

    room.kickedNicknames.add(target.normalizedNickname);
    room.kickedSessionTokenHashes.add(target.sessionTokenHash);
    room.players.delete(targetPlayerId);
    const targetConnection = room.connections.get(targetPlayerId);
    room.connections.delete(targetPlayerId);
    if (room.drawerId === targetPlayerId && room.moderatorId) {
      room.drawerId = room.moderatorId;
      room.round.drawing.drawerEpoch += 1;
      if (room.round.hasKeyword) room.round.keywordExposedPlayerIds.add(room.moderatorId);
    }
    room.roomVersion += 1;
    room.eventSeq += 1;

    if (targetConnection) {
      targetConnection.explicitlyLeft = true;
      sendEnvelope(targetConnection, envelope('KICKED', {
        roomCode: room.roomCode,
        reason: 'REMOVED_BY_MODERATOR'
      }, { eventSeq: room.eventSeq, roundId: room.round.roundId }));
      targetConnection.ws.close(4003, '강퇴되었습니다.');
    }
    broadcast(room, envelope('PLAYER_KICKED', {
      playerId: target.playerId,
      nickname: target.nickname
    }, { eventSeq: room.eventSeq, roundId: room.round.roundId }));
    this.publishState(room);
  }

  closeRoom(room: RoomRuntime, reason: 'HOST_LEFT' | 'HOST_ABSENT_TIMEOUT' | 'SERVER_SHUTDOWN'): void {
    if (room.status === 'CLOSED') return;
    if (room.roundTimer) clearTimeout(room.roundTimer);
    if (room.hostTimer) clearTimeout(room.hostTimer);
    room.roundTimer = null;
    room.hostTimer = null;
    room.status = 'CLOSED';
    room.roomVersion += 1;
    room.eventSeq += 1;
    const closedAt = Date.now();
    for (const connection of room.connections.values()) {
      sendEnvelope(connection, envelope('ROOM_CLOSED', {
        roomCode: room.roomCode,
        reason,
        closedAt
      }, { roomVersion: room.roomVersion, eventSeq: room.eventSeq, roundId: room.round.roundId }));
      connection.roomCode = null;
      connection.playerId = null;
      connection.explicitlyLeft = true;
    }
    room.connections.clear();
    room.round.drawing.acceptedBatches.clear();
    this.registry.delete(room.roomCode);
  }
}
