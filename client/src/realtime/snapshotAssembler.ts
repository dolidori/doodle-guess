import type {
  AuthoritativeDrawing,
  DrawingSnapshotPayload,
  SnapshotFragment,
  Stroke
} from '../../../shared/src/index.js';

type Assembly = {
  chunks: Map<number, DrawingSnapshotPayload>;
  totalChunks: number;
  roundId: string;
  drawingRevision: number;
  lastDrawingSeq: number;
  sha256: string;
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export class SnapshotAssembler {
  private readonly assemblies = new Map<string, Assembly>();

  async add(payload: DrawingSnapshotPayload): Promise<AuthoritativeDrawing | null> {
    if (
      !Number.isInteger(payload.totalChunks) ||
      payload.totalChunks < 1 ||
      !Number.isInteger(payload.chunkIndex) ||
      payload.chunkIndex < 0 ||
      payload.chunkIndex >= payload.totalChunks
    ) {
      throw new Error('그림 스냅샷 청크 번호가 올바르지 않습니다.');
    }
    const assembly = this.assemblies.get(payload.snapshotId) ?? {
      chunks: new Map(),
      totalChunks: payload.totalChunks,
      roundId: payload.roundId,
      drawingRevision: payload.drawingRevision,
      lastDrawingSeq: payload.lastDrawingSeq,
      sha256: payload.sha256
    };
    if (
      assembly.totalChunks !== payload.totalChunks ||
      assembly.roundId !== payload.roundId ||
      assembly.drawingRevision !== payload.drawingRevision ||
      assembly.lastDrawingSeq !== payload.lastDrawingSeq ||
      assembly.sha256 !== payload.sha256
    ) {
      this.assemblies.delete(payload.snapshotId);
      throw new Error('그림 스냅샷 청크 정보가 서로 다릅니다.');
    }
    const duplicate = assembly.chunks.get(payload.chunkIndex);
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(payload)) {
      this.assemblies.delete(payload.snapshotId);
      throw new Error('그림 스냅샷 중복 청크가 서로 다릅니다.');
    }
    assembly.chunks.set(payload.chunkIndex, payload);
    this.assemblies.set(payload.snapshotId, assembly);
    if (assembly.chunks.size !== assembly.totalChunks) return null;
    this.assemblies.delete(payload.snapshotId);
    const ordered = [...assembly.chunks.values()].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const fragments = ordered.flatMap((chunk) => chunk.fragments);
    const grouped = new Map<string, SnapshotFragment[]>();
    for (const fragment of fragments) {
      const list = grouped.get(fragment.strokeId) ?? [];
      list.push(fragment);
      grouped.set(fragment.strokeId, list);
    }
    const strokes: Stroke[] = [...grouped.values()].map((parts) => {
      parts.sort((a, b) => a.fragmentIndex - b.fragmentIndex);
      const first = parts[0]!;
      if (
        parts.length !== first.fragmentCount ||
        parts.some((part, index) =>
          part.fragmentIndex !== index ||
          part.fragmentCount !== first.fragmentCount ||
          part.authorId !== first.authorId ||
          part.tool !== first.tool ||
          part.color !== first.color ||
          part.width !== first.width ||
          part.finalized !== first.finalized ||
          part.lastBatchSeq !== first.lastBatchSeq
        )
      ) {
        throw new Error('그림 스냅샷 스트로크 조각이 올바르지 않습니다.');
      }
      return {
        strokeId: first.strokeId,
        authorId: first.authorId,
        roundId: payload.roundId,
        drawingRevision: payload.drawingRevision,
        drawerEpoch: 0,
        tool: first.tool,
        color: first.color,
        width: first.width,
        points: parts.flatMap((part) => part.points),
        finalized: first.finalized,
        lastBatchSeq: first.lastBatchSeq,
        undone: false,
        createdAt: 0
      };
    });
    const canonical = strokes.map((stroke) => ({
      strokeId: stroke.strokeId,
      authorId: stroke.authorId,
      tool: stroke.tool,
      color: stroke.color,
      width: stroke.width,
      finalized: stroke.finalized,
      lastBatchSeq: stroke.lastBatchSeq,
      points: stroke.points
    }));
    if (await sha256(JSON.stringify(canonical)) !== payload.sha256) {
      throw new Error('그림 스냅샷 검증에 실패했습니다.');
    }
    return {
      roundId: payload.roundId,
      drawingRevision: payload.drawingRevision,
      drawingSeq: payload.lastDrawingSeq,
      strokes
    };
  }

  clear(): void {
    this.assemblies.clear();
  }
}
