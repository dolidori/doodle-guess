import type {
  Stroke,
  StrokeBatchEvent,
  StrokeBatchPayload
} from '../../../shared/src/index.js';
import { broadcast, envelope, sendEnvelope } from '../broadcast/roomBroadcast.js';
import { GameService } from '../game/gameService.js';
import { ProtocolError, assertProtocol } from '../protocol/errors.js';
import { RoomService } from '../rooms/roomService.js';
import type { ClientConnection, RoomRuntime } from '../rooms/types.js';
import { sendDrawingSnapshot } from './snapshotService.js';
import {
  assertDrawingCapacity,
  assertDrawingIdentity,
  assertStrokeCapacity
} from './strokeValidation.js';

const batchKey = (payload: StrokeBatchPayload): string =>
  `${payload.roundId}:${payload.drawingRevision}:${payload.strokeId}:${payload.batchSeq}`;

const styleMatches = (stroke: Stroke, payload: StrokeBatchPayload): boolean =>
  stroke.tool === payload.tool &&
  stroke.color === payload.color &&
  stroke.width === payload.width;

export class DrawingService {
  constructor(
    private readonly gameService: GameService,
    private readonly roomService: RoomService
  ) {}

  draw(
    room: RoomRuntime,
    actorId: string,
    payload: StrokeBatchPayload,
    connection: ClientConnection
  ): void {
    this.gameService.ensureActiveBeforeDeadline(room, payload.roundId);
    assertProtocol(room.drawerId === actorId, 'NOT_DRAWER', '현재 그리기 담당자가 아닙니다.');
    assertProtocol(!room.round.drawingLocked, 'ROUND_LOCKED', '그림 입력이 잠겼습니다.');
    assertDrawingIdentity(room, payload);

    const key = batchKey(payload);
    const duplicate = room.round.drawing.acceptedBatches.get(key);
    if (duplicate) {
      sendEnvelope(connection, envelope('STROKE_BATCH', duplicate, {
        roomVersion: room.roomVersion,
        roundId: room.round.roundId
      }), true);
      return;
    }

    const drawing = room.round.drawing;
    let stroke = drawing.strokes.find((candidate) => candidate.strokeId === payload.strokeId);
    const expectedBatchSeq = stroke ? stroke.lastBatchSeq + 1 : 0;
    if (payload.batchSeq > expectedBatchSeq) {
      sendDrawingSnapshot(room, connection);
      throw new ProtocolError('STROKE_SEQUENCE_GAP', '스트로크 배치가 누락되었습니다.', {
        expected: expectedBatchSeq,
        received: payload.batchSeq,
        drawingRevision: drawing.drawingRevision
      });
    }
    assertProtocol(
      payload.batchSeq === expectedBatchSeq,
      'INVALID_STROKE',
      '이미 종료되었거나 오래된 스트로크 배치입니다.'
    );
    assertProtocol(!stroke?.finalized, 'INVALID_STROKE', '이미 종료된 스트로크입니다.');
    if (stroke) {
      assertProtocol(styleMatches(stroke, payload), 'STROKE_STYLE_MISMATCH', '스트로크 스타일이 바뀌었습니다.');
    }

    const addedBytes = Buffer.byteLength(JSON.stringify(payload.points), 'utf8') + 128;
    assertStrokeCapacity(stroke?.points.length ?? 0, payload.points.length);
    assertDrawingCapacity(drawing, payload.points.length, addedBytes, !stroke);

    if (!stroke) {
      stroke = {
        strokeId: payload.strokeId,
        authorId: actorId,
        roundId: payload.roundId,
        drawingRevision: payload.drawingRevision,
        drawerEpoch: payload.drawerEpoch,
        tool: payload.tool,
        color: payload.color,
        width: payload.width,
        points: [],
        finalized: false,
        lastBatchSeq: -1,
        undone: false,
        createdAt: Date.now()
      };
      drawing.strokes.push(stroke);
      drawing.strokeCount += 1;
    }
    stroke.points.push(...payload.points);
    stroke.lastBatchSeq = payload.batchSeq;
    stroke.finalized = payload.isFinal;
    drawing.pointCount += payload.points.length;
    drawing.serializedBytes += addedBytes;
    drawing.drawingSeq += 1;
    room.eventSeq += 1;

    const event: StrokeBatchEvent = {
      ...payload,
      drawingSeq: drawing.drawingSeq,
      authorId: actorId
    };
    drawing.acceptedBatches.set(key, event);
    broadcast(room, envelope('STROKE_BATCH', event, {
      roomVersion: room.roomVersion,
      roundId: room.round.roundId
    }), true);
  }

  undo(
    room: RoomRuntime,
    actorId: string,
    payload: { roundId: string; drawingRevision: number; drawerEpoch: number }
  ): void {
    this.gameService.ensureActiveBeforeDeadline(room, payload.roundId);
    assertProtocol(room.drawerId === actorId, 'NOT_DRAWER', '현재 그리기 담당자가 아닙니다.');
    assertDrawingIdentity(room, payload);
    const stroke = [...room.round.drawing.strokes]
      .reverse()
      .find((candidate) => candidate.finalized && !candidate.undone);
    assertProtocol(stroke, 'NO_STROKE_TO_UNDO', '되돌릴 스트로크가 없습니다.');
    stroke.finalized = true;
    stroke.undone = true;
    room.round.drawing.drawingSeq += 1;
    room.eventSeq += 1;
    broadcast(room, envelope('STROKE_UNDONE', {
      roundId: room.round.roundId,
      drawingRevision: room.round.drawing.drawingRevision,
      drawingSeq: room.round.drawing.drawingSeq,
      strokeId: stroke.strokeId
    }, {
      roomVersion: room.roomVersion,
      eventSeq: room.eventSeq,
      roundId: room.round.roundId
    }));
    this.roomService.publishState(room);
  }

  clear(
    room: RoomRuntime,
    actorId: string,
    payload: { roundId: string; drawingRevision: number; drawerEpoch: number }
  ): void {
    this.gameService.ensureActiveBeforeDeadline(room, payload.roundId);
    assertProtocol(room.drawerId === actorId, 'NOT_DRAWER', '현재 그리기 담당자가 아닙니다.');
    assertDrawingIdentity(room, payload);
    const drawing = room.round.drawing;
    drawing.drawingRevision += 1;
    drawing.drawingSeq = 0;
    drawing.strokes = [];
    drawing.strokeCount = 0;
    drawing.pointCount = 0;
    drawing.serializedBytes = 0;
    drawing.acceptedBatches.clear();
    room.roomVersion += 1;
    room.eventSeq += 1;
    broadcast(room, envelope('DRAWING_CLEARED', {
      roundId: room.round.roundId,
      drawingRevision: drawing.drawingRevision,
      drawingSeq: 0
    }, {
      roomVersion: room.roomVersion,
      eventSeq: room.eventSeq,
      roundId: room.round.roundId
    }));
    this.roomService.publishState(room);
  }
}
