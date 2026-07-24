import { describe, expect, it } from 'vitest';
import { advanceDrawingSequence } from './drawingSequence.js';

describe('그림 실시간 순번 추적', () => {
  it('화면 렌더링 전 연속 delta도 정상 순서로 처리한다', () => {
    const initial = { roundId: 'round-1', drawingRevision: 0, drawingSeq: 0 };
    const first = advanceDrawingSequence(initial, { ...initial, drawingSeq: 1 });
    expect(first.status).toBe('APPLY');

    const second = advanceDrawingSequence(first.cursor, { ...initial, drawingSeq: 2 });
    expect(second.status).toBe('APPLY');
    expect(second.cursor.drawingSeq).toBe(2);
  });

  it('실제로 순번이 건너뛴 경우만 gap으로 판정한다', () => {
    const cursor = { roundId: 'round-1', drawingRevision: 0, drawingSeq: 1 };
    expect(advanceDrawingSequence(cursor, { ...cursor, drawingSeq: 3 }).status).toBe('GAP');
    expect(advanceDrawingSequence(cursor, { ...cursor, drawingSeq: 1 }).status).toBe('IGNORE');
  });
});
