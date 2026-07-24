// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type {
  DrawingSnapshotPayload,
  SnapshotFragment
} from '../../../shared/src/index.js';
import { SnapshotAssembler } from './snapshotAssembler.js';

const hash = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const fragment = (
  strokeId: string,
  fragmentIndex: number,
  points: Array<{ x: number; y: number }>
): SnapshotFragment => ({
  strokeId,
  authorId: 'author',
  tool: 'PEN',
  color: 'BLACK',
  width: 'MEDIUM',
  finalized: true,
  lastBatchSeq: 1,
  fragmentIndex,
  fragmentCount: 2,
  points
});

describe('drawing snapshot assembler', () => {
  it('순서가 바뀐 청크를 조립하고 SHA-256이 같은 벡터로 수렴한다', async () => {
    const strokeId = crypto.randomUUID();
    const canonical = [{
      strokeId,
      authorId: 'author',
      tool: 'PEN',
      color: 'BLACK',
      width: 'MEDIUM',
      finalized: true,
      lastBatchSeq: 1,
      points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }]
    }];
    const sha256 = await hash(JSON.stringify(canonical));
    const common = {
      snapshotId: crypto.randomUUID(),
      roundId: crypto.randomUUID(),
      drawingRevision: 3,
      lastDrawingSeq: 7,
      totalChunks: 2,
      sha256
    };
    const second: DrawingSnapshotPayload = {
      ...common,
      chunkIndex: 1,
      fragments: [fragment(strokeId, 1, [{ x: 0.3, y: 0.4 }])]
    };
    const first: DrawingSnapshotPayload = {
      ...common,
      chunkIndex: 0,
      fragments: [fragment(strokeId, 0, [{ x: 0.1, y: 0.2 }])]
    };
    const assembler = new SnapshotAssembler();
    expect(await assembler.add(second)).toBeNull();
    const drawing = await assembler.add(first);
    expect(drawing).toMatchObject({
      roundId: common.roundId,
      drawingRevision: 3,
      drawingSeq: 7
    });
    expect(drawing?.strokes[0]?.points).toEqual(canonical[0]!.points);
  });

  it('서로 다른 metadata, 잘못된 index, 불완전 fragment와 hash를 거부한다', async () => {
    const base: DrawingSnapshotPayload = {
      snapshotId: crypto.randomUUID(),
      roundId: crypto.randomUUID(),
      drawingRevision: 0,
      lastDrawingSeq: 0,
      chunkIndex: 0,
      totalChunks: 2,
      sha256: '0'.repeat(64),
      fragments: []
    };
    const assembler = new SnapshotAssembler();
    expect(await assembler.add(base)).toBeNull();
    await expect(assembler.add({
      ...base,
      chunkIndex: 1,
      drawingRevision: 1
    })).rejects.toThrow('청크 정보');
    await expect(new SnapshotAssembler().add({
      ...base,
      chunkIndex: 2
    })).rejects.toThrow('청크 번호');

    const strokeId = crypto.randomUUID();
    const incomplete: DrawingSnapshotPayload = {
      ...base,
      snapshotId: crypto.randomUUID(),
      totalChunks: 1,
      fragments: [fragment(strokeId, 0, [{ x: 0.1, y: 0.2 }])]
    };
    incomplete.fragments[0]!.fragmentCount = 2;
    await expect(new SnapshotAssembler().add(incomplete)).rejects.toThrow('스트로크 조각');

    const badHash: DrawingSnapshotPayload = {
      ...base,
      snapshotId: crypto.randomUUID(),
      totalChunks: 1,
      fragments: []
    };
    await expect(new SnapshotAssembler().add(badHash)).rejects.toThrow('검증에 실패');
  });
});
