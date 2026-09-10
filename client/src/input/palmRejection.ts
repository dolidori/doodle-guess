/**
 * 스타일러스 우선 팜 리젝션.
 * - 펜이 한 번이라도 감지되면 캔버스에서는 터치 그리기를 무시한다.
 * - 펜이 활동 중(마지막 펜 입력 직후)인 동안에는 화면 전체의 터치 입력을 차단해
 *   그림을 그리다 손바닥이 옆 패널을 건드리는 것을 막는다.
 */
const PEN_ACTIVE_WINDOW_MS = 700;

let penDetected = false;
let lastPenAt = 0;

/** 펜이 감지된 뒤라면 터치 입력으로는 그림을 그리지 않는다. */
export const shouldIgnoreTouchDrawing = (pointerType: string): boolean =>
  penDetected && pointerType === 'touch';

const isPenActive = (): boolean =>
  penDetected && performance.now() - lastPenAt < PEN_ACTIVE_WINDOW_MS;

export const installPalmRejection = (): void => {
  const notePen = (event: PointerEvent): void => {
    if (event.pointerType !== 'pen') return;
    penDetected = true;
    lastPenAt = performance.now();
  };

  const blockPointer = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || !isPenActive()) return;
    event.stopPropagation();
    event.preventDefault();
  };

  const blockTouch = (event: TouchEvent): void => {
    if (!isPenActive()) return;
    // Safari는 애플펜슬 접촉을 touchType 'stylus'로 표시한다.
    const fromStylus = Array.from(event.changedTouches).some(
      (touch) => (touch as Touch & { touchType?: string }).touchType === 'stylus'
    );
    if (fromStylus) return;
    event.stopPropagation();
    event.preventDefault();
  };

  window.addEventListener('pointerdown', notePen, { capture: true, passive: true });
  window.addEventListener('pointermove', notePen, { capture: true, passive: true });
  window.addEventListener('pointerdown', blockPointer, { capture: true });
  window.addEventListener('pointerup', blockPointer, { capture: true });
  window.addEventListener('touchstart', blockTouch, { capture: true, passive: false });
  window.addEventListener('touchend', blockTouch, { capture: true, passive: false });
};
