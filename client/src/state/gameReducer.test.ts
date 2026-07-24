// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { PublicState, StrokeBatchEvent } from '../../../shared/src/index.js';
import { gameReducer, initialState } from './gameReducer.js';

const publicState = (): PublicState => ({
  roomCode: '123',
  mode: 'NORMAL',
  answerMode: 'FIRST_CORRECT',
  status: 'ROUND_ACTIVE',
  roomVersion: 2,
  eventSeq: 2,
  serverNow: 1000,
  hostDisconnectedAt: null,
  expiresAt: null,
  players: [],
  drawerId: crypto.randomUUID(),
  drawerEpoch: 0,
  round: {
    roundId: crypto.randomUUID(),
    roundNumber: 1,
    status: 'DRAWING_AND_GUESSING',
    durationSeconds: 60,
    startedAt: 1000,
    roundEndsAt: 61_000,
    hasKeyword: true,
    guessLocked: false,
    drawingLocked: false,
    winnerId: null,
    winnerNickname: null,
    solvedAt: null,
    expiredAt: null,
    lastRoundEventId: null,
    guessSeq: 0,
    correctCount: 0
  },
  drawing: { drawingRevision: 0, drawingSeq: 0, strokeCount: 0, pointCount: 0 },
  guessFeed: []
});

describe('클라이언트 reducer 순서와 중복 제거', () => {
  it('낮은 roomVersion 상태를 무시한다', () => {
    const current = gameReducer(initialState, { type: 'PUBLIC_STATE', state: publicState() });
    const stale = { ...current.publicState!, roomVersion: 1 };
    expect(gameReducer(current, { type: 'PUBLIC_STATE', state: stale })).toBe(current);
  });

  it('같은 결과 eventId 모달을 한 번만 추가한다', () => {
    const payload = {
      eventId: crypto.randomUUID(),
      winnerNickname: '정답자'
    };
    const once = gameReducer(initialState, { type: 'ROUND_SOLVED', payload });
    const twice = gameReducer(once, { type: 'ROUND_SOLVED', payload });
    expect(twice.modalQueue).toHaveLength(1);
  });

  it('drawingSeq가 연속인 delta만 적용한다', () => {
    const stateWithPublic = gameReducer(initialState, { type: 'PUBLIC_STATE', state: publicState() });
    const base: StrokeBatchEvent = {
      roundId: stateWithPublic.publicState!.round.roundId,
      drawingRevision: 0,
      drawingSeq: 1,
      drawerEpoch: 0,
      strokeId: crypto.randomUUID(),
      batchSeq: 0,
      isFinal: true,
      authorId: crypto.randomUUID(),
      tool: 'PEN',
      color: 'BLACK',
      width: 'MEDIUM',
      points: [{ x: 0.1, y: 0.2 }]
    };
    const applied = gameReducer(stateWithPublic, { type: 'STROKE_BATCH', event: base });
    expect(applied.drawing.drawingSeq).toBe(1);
    const gap = gameReducer(applied, {
      type: 'STROKE_BATCH',
      event: { ...base, drawingSeq: 3, batchSeq: 1 }
    });
    expect(gap.drawing.drawingSeq).toBe(1);
  });

  it('이전 round/revision의 undo와 drawingSeq gap을 무시한다', () => {
    const stateWithPublic = gameReducer(initialState, { type: 'PUBLIC_STATE', state: publicState() });
    const withStroke = {
      ...stateWithPublic,
      drawing: {
        roundId: stateWithPublic.publicState!.round.roundId,
        drawingRevision: 2,
        drawingSeq: 4,
        strokes: [{
          strokeId: crypto.randomUUID(),
          authorId: crypto.randomUUID(),
          roundId: stateWithPublic.publicState!.round.roundId,
          drawingRevision: 2,
          drawerEpoch: 0,
          tool: 'PEN' as const,
          color: 'BLACK' as const,
          width: 'MEDIUM' as const,
          points: [{ x: 0.1, y: 0.1 }],
          finalized: true,
          lastBatchSeq: 0,
          undone: false,
          createdAt: 0
        }]
      }
    };
    const strokeId = withStroke.drawing.strokes[0]!.strokeId;
    const stale = gameReducer(withStroke, {
      type: 'STROKE_UNDONE',
      roundId: crypto.randomUUID(),
      drawingRevision: 2,
      drawingSeq: 5,
      strokeId
    });
    expect(stale).toBe(withStroke);
    const gap = gameReducer(withStroke, {
      type: 'STROKE_UNDONE',
      roundId: withStroke.drawing.roundId!,
      drawingRevision: 2,
      drawingSeq: 6,
      strokeId
    });
    expect(gap).toBe(withStroke);
    const applied = gameReducer(withStroke, {
      type: 'STROKE_UNDONE',
      roundId: withStroke.drawing.roundId!,
      drawingRevision: 2,
      drawingSeq: 5,
      strokeId
    });
    expect(applied.drawing.strokes[0]?.undone).toBe(true);
  });
});
