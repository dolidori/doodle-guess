import type { PALETTE, STROKE_WIDTHS } from '../protocol/constants.js';

export type PaletteColor = keyof typeof PALETTE;
export type StrokeWidth = keyof typeof STROKE_WIDTHS;
export type StrokeTool = 'PEN' | 'ERASER';
export type Point = { x: number; y: number };

export type Stroke = {
  strokeId: string;
  authorId: string;
  roundId: string;
  drawingRevision: number;
  drawerEpoch: number;
  tool: StrokeTool;
  color: PaletteColor | null;
  width: StrokeWidth;
  points: Point[];
  finalized: boolean;
  lastBatchSeq: number;
  undone: boolean;
  createdAt: number;
};

export type StrokeBatchPayload = {
  roundId: string;
  drawingRevision: number;
  drawerEpoch: number;
  strokeId: string;
  batchSeq: number;
  isFinal: boolean;
  tool: StrokeTool;
  color: PaletteColor | null;
  width: StrokeWidth;
  points: Point[];
};

export type StrokeBatchEvent = StrokeBatchPayload & {
  drawingSeq: number;
  authorId: string;
};

export type SnapshotFragment = {
  strokeId: string;
  authorId: string;
  tool: StrokeTool;
  color: PaletteColor | null;
  width: StrokeWidth;
  finalized: boolean;
  lastBatchSeq: number;
  fragmentIndex: number;
  fragmentCount: number;
  points: Point[];
};

export type DrawingSnapshotPayload = {
  snapshotId: string;
  roundId: string;
  drawingRevision: number;
  lastDrawingSeq: number;
  chunkIndex: number;
  totalChunks: number;
  sha256: string;
  fragments: SnapshotFragment[];
};
