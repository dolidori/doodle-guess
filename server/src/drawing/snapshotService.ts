import { createHash, randomUUID } from 'node:crypto';
import {
  MAX_SNAPSHOT_CHUNK_BYTES,
  SLOW_CONNECTION_BYTES,
  type DrawingSnapshotPayload,
  type SnapshotFragment,
  type Stroke
} from '../../../shared/src/index.js';
import { envelope, sendEnvelope } from '../broadcast/roomBroadcast.js';
import type { ClientConnection, RoomRuntime } from '../rooms/types.js';

export type CanonicalStroke = Pick<
  Stroke,
  'strokeId' | 'authorId' | 'tool' | 'color' | 'width' | 'finalized' | 'lastBatchSeq' | 'points'
>;

export const canonicalDrawing = (room: RoomRuntime): CanonicalStroke[] =>
  room.round.drawing.strokes
    .filter((stroke) => !stroke.undone)
    .map(({ strokeId, authorId, tool, color, width, finalized, lastBatchSeq, points }) => ({
      strokeId, authorId, tool, color, width, finalized, lastBatchSeq, points
    }));

export const canonicalDrawingJson = (room: RoomRuntime): string =>
  JSON.stringify(canonicalDrawing(room));

const fragmentsFor = (strokes: CanonicalStroke[]): SnapshotFragment[] => {
  const fragments: SnapshotFragment[] = [];
  for (const stroke of strokes) {
    const fragmentCount = Math.max(1, Math.ceil(stroke.points.length / 512));
    for (let fragmentIndex = 0; fragmentIndex < fragmentCount; fragmentIndex += 1) {
      fragments.push({
        ...stroke,
        fragmentIndex,
        fragmentCount,
        points: stroke.points.slice(fragmentIndex * 512, (fragmentIndex + 1) * 512)
      });
    }
  }
  return fragments;
};

const chunkFragments = (fragments: SnapshotFragment[]): SnapshotFragment[][] => {
  const chunks: SnapshotFragment[][] = [[]];
  for (const fragment of fragments) {
    let chunk = chunks[chunks.length - 1]!;
    const candidate = [...chunk, fragment];
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_SNAPSHOT_CHUNK_BYTES - 2048 && chunk.length) {
      chunk = [];
      chunks.push(chunk);
    }
    chunk.push(fragment);
  }
  return chunks;
};

export const sendDrawingSnapshot = (room: RoomRuntime, connection: ClientConnection): void => {
  const canonical = canonicalDrawing(room);
  const json = JSON.stringify(canonical);
  const sha256 = createHash('sha256').update(json).digest('hex');
  const chunks = chunkFragments(fragmentsFor(canonical));
  const snapshotId = randomUUID();
  for (const [chunkIndex, fragments] of chunks.entries()) {
    if (connection.ws.bufferedAmount >= SLOW_CONNECTION_BYTES) {
      connection.needsSnapshot = true;
      return;
    }
    const payload: DrawingSnapshotPayload = {
      snapshotId,
      roundId: room.round.roundId,
      drawingRevision: room.round.drawing.drawingRevision,
      lastDrawingSeq: room.round.drawing.drawingSeq,
      chunkIndex,
      totalChunks: chunks.length,
      sha256,
      fragments
    };
    sendEnvelope(connection, envelope('DRAWING_SNAPSHOT', payload, {
      roomVersion: room.roomVersion,
      roundId: room.round.roundId
    }));
  }
  connection.needsSnapshot = false;
};
