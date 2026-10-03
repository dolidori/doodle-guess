// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { installPalmRejection } from './palmRejection.js';

const pointer = (type: string, pointerType: string, x: number, y: number): Event =>
  Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerType, clientX: x, clientY: y });

// jsdom에는 Touch 생성자가 없어 changedTouches만 흉내 낸다
const touch = (type: string, x: number, y: number, touchType?: string): Event =>
  Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    changedTouches: [{ clientX: x, clientY: y, touchType }]
  });

const blocked = (event: Event): boolean => !document.body.dispatchEvent(event);

describe('팜 리젝션', () => {
  beforeAll(() => installPalmRejection());

  it('크롬북: 펜으로 메뉴를 누르면 그 펜이 만든 터치는 막지 않는다', () => {
    document.body.dispatchEvent(pointer('pointerdown', 'pen', 100, 200));
    expect(blocked(touch('touchstart', 100, 200))).toBe(false);
    document.body.dispatchEvent(pointer('pointerup', 'pen', 101, 201));
    expect(blocked(touch('touchend', 101, 201))).toBe(false);
  });

  it('펜을 쓰는 동안 펜 끝에서 떨어진 손바닥 터치는 막는다', () => {
    document.body.dispatchEvent(pointer('pointermove', 'pen', 100, 200));
    expect(blocked(touch('touchstart', 300, 450))).toBe(true);
    expect(blocked(pointer('pointerdown', 'touch', 300, 450))).toBe(true);
  });

  it('아이패드: stylus로 표시된 터치는 위치와 상관없이 통과한다', () => {
    document.body.dispatchEvent(pointer('pointermove', 'pen', 100, 200));
    expect(blocked(touch('touchstart', 500, 500, 'stylus'))).toBe(false);
  });
});
