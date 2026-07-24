import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ACTIONS,
  CLIENT_EVENT_TYPES,
  PALETTE,
  SERVER_EVENT_TYPES,
  STROKE_WIDTHS
} from '../../../shared/src/index.js';
import { normalizeGuess } from '../game/keywordService.js';
import { parseCommand } from '../protocol/schemas.js';

describe('공용 계약', () => {
  it('이벤트와 액션 개수가 기준 문서와 일치한다', () => {
    expect(CLIENT_EVENT_TYPES).toHaveLength(15);
    expect(SERVER_EVENT_TYPES).toHaveLength(14);
    expect(ALLOWED_ACTIONS).toHaveLength(13);
  });

  it('팔레트와 굵기 값이 고정되어 있다', () => {
    expect(PALETTE).toEqual({
      BLACK: { hex: '#111827', label: '검정' },
      BLUE: { hex: '#0072B2', label: '파랑' },
      ORANGE: { hex: '#E69F00', label: '주황' },
      GREEN: { hex: '#009E73', label: '초록' },
      VERMILION: { hex: '#D55E00', label: '다홍' },
      PURPLE: { hex: '#7B2CBF', label: '보라' }
    });
    expect(STROKE_WIDTHS).toEqual({ THIN: 0.003, MEDIUM: 0.007, THICK: 0.014 });
  });

  it('모든 ECMAScript 공백만 제거한다', () => {
    expect(normalizeGuess('가 나\t다\n라\u00a0마\u3000바')).toBe('가나다라마바');
    expect(normalizeGuess('Apple!')).not.toBe(normalizeGuess('apple!'));
    expect(normalizeGuess('é')).not.toBe(normalizeGuess('e\u0301'));
  });

  it('strict payload의 알 수 없는 필드를 거부한다', () => {
    expect(() => parseCommand({
      v: 1,
      type: 'CREATE_ROOM',
      requestId: crypto.randomUUID(),
      payload: { nickname: '대표님', mode: 'NORMAL', isHost: true }
    })).toThrow();
  });

  it.each([20, 60, 180])('유효한 제한 시간 %i초를 허용한다', (durationSeconds) => {
    expect(parseCommand({
      v: 1,
      type: 'SET_ROUND_DURATION',
      requestId: crypto.randomUUID(),
      payload: { durationSeconds }
    }).payload).toEqual({ durationSeconds });
  });

  it.each([15, 21, 185])('유효하지 않은 제한 시간 %i초를 거부한다', (durationSeconds) => {
    expect(() => parseCommand({
      v: 1,
      type: 'SET_ROUND_DURATION',
      requestId: crypto.randomUUID(),
      payload: { durationSeconds }
    })).toThrow();
  });

  it.each(['FIRST_CORRECT', 'UNTIL_TIMER'])('유효한 정답 모드 %s를 허용한다', (answerMode) => {
    expect(parseCommand({
      v: 1,
      type: 'SET_ANSWER_MODE',
      requestId: crypto.randomUUID(),
      payload: { answerMode }
    }).payload).toEqual({ answerMode });
  });

  it('알 수 없는 정답 모드를 거부한다', () => {
    expect(() => parseCommand({
      v: 1,
      type: 'SET_ANSWER_MODE',
      requestId: crypto.randomUUID(),
      payload: { answerMode: 'PER_PLAYER' }
    })).toThrow();
  });

  it('범위 밖 좌표와 잘못된 PEN/ERASER 색 조건을 거부한다', () => {
    const base = {
      v: 1,
      type: 'DRAW_STROKE_BATCH',
      requestId: crypto.randomUUID(),
      payload: {
        roundId: crypto.randomUUID(),
        drawingRevision: 0,
        drawerEpoch: 0,
        strokeId: crypto.randomUUID(),
        batchSeq: 0,
        isFinal: true,
        tool: 'PEN',
        color: 'BLACK',
        width: 'MEDIUM',
        points: [{ x: 0.5, y: 1.1 }]
      }
    };
    expect(() => parseCommand(base)).toThrow();
    expect(() => parseCommand({
      ...base,
      requestId: crypto.randomUUID(),
      payload: { ...base.payload, points: [{ x: 0.5, y: 0.5 }], color: null }
    })).toThrow();
    expect(() => parseCommand({
      ...base,
      requestId: crypto.randomUUID(),
      payload: {
        ...base.payload,
        points: [{ x: 0.5, y: 0.5 }],
        tool: 'ERASER',
        color: 'BLACK'
      }
    })).toThrow();
  });

  it.each(['100', '999'])('유효한 방번호 %s를 허용한다', (roomCode) => {
    expect(parseCommand({
      v: 1,
      type: 'JOIN_ROOM',
      requestId: crypto.randomUUID(),
      payload: { roomCode, nickname: '참가자' }
    }).payload).toEqual({ roomCode, nickname: '참가자' });
  });

  it.each(['099', '1000', 'abc', ''])('유효하지 않은 방번호 %j를 거부한다', (roomCode) => {
    expect(() => parseCommand({
      v: 1,
      type: 'JOIN_ROOM',
      requestId: crypto.randomUUID(),
      payload: { roomCode, nickname: '참가자' }
    })).toThrow();
  });

  it('NaN·Infinity·65점 batch를 거부한다', () => {
    const payload = {
      roundId: crypto.randomUUID(),
      drawingRevision: 0,
      drawerEpoch: 0,
      strokeId: crypto.randomUUID(),
      batchSeq: 0,
      isFinal: true,
      tool: 'PEN',
      color: 'BLACK',
      width: 'MEDIUM',
      points: [{ x: 0.5, y: 0.5 }]
    };
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => parseCommand({
        v: 1,
        type: 'DRAW_STROKE_BATCH',
        requestId: crypto.randomUUID(),
        payload: { ...payload, points: [{ x: value, y: 0.5 }] }
      })).toThrow();
    }
    expect(() => parseCommand({
      v: 1,
      type: 'DRAW_STROKE_BATCH',
      requestId: crypto.randomUUID(),
      payload: {
        ...payload,
        points: Array.from({ length: 65 }, () => ({ x: 0.5, y: 0.5 }))
      }
    })).toThrow();
  });

  it('허용되지 않은 mode와 제어문자가 포함된 텍스트를 거부한다', () => {
    expect(() => parseCommand({
      v: 1,
      type: 'CREATE_ROOM',
      requestId: crypto.randomUUID(),
      payload: { nickname: '참가자', mode: 'TEAM' }
    })).toThrow();
    expect(() => parseCommand({
      v: 1,
      type: 'CREATE_ROOM',
      requestId: crypto.randomUUID(),
      payload: { nickname: '참가\u0000자', mode: 'NORMAL' }
    })).toThrow();
  });
});
