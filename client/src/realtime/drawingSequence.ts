import type { AuthoritativeDrawing } from '../../../shared/src/index.js';

export type DrawingSequenceCursor = Pick<
  AuthoritativeDrawing,
  'roundId' | 'drawingRevision' | 'drawingSeq'
>;

export type DrawingSequenceResult =
  | { status: 'APPLY'; cursor: DrawingSequenceCursor }
  | { status: 'IGNORE'; cursor: DrawingSequenceCursor }
  | { status: 'GAP'; cursor: DrawingSequenceCursor };

export const cursorFromDrawing = (
  drawing: AuthoritativeDrawing
): DrawingSequenceCursor => ({
  roundId: drawing.roundId,
  drawingRevision: drawing.drawingRevision,
  drawingSeq: drawing.drawingSeq
});

export const advanceDrawingSequence = (
  cursor: DrawingSequenceCursor,
  event: DrawingSequenceCursor
): DrawingSequenceResult => {
  if (
    cursor.roundId !== event.roundId ||
    cursor.drawingRevision !== event.drawingRevision ||
    event.drawingSeq <= cursor.drawingSeq
  ) {
    return { status: 'IGNORE', cursor };
  }
  if (event.drawingSeq > cursor.drawingSeq + 1) {
    return { status: 'GAP', cursor };
  }
  return { status: 'APPLY', cursor: event };
};
