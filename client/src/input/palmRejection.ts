/**
 * 스타일러스 우선 팜 리젝션.
 * - 펜이 한 번이라도 감지되면 캔버스에서는 터치 그리기를 무시한다.
 * - 펜이 활동 중(마지막 펜 입력 직후)인 동안에는 화면 전체의 터치 입력을 차단해
 *   그림을 그리다 손바닥이 옆 패널을 건드리는 것을 막는다.
 * - 펜 접촉도 터치 이벤트로 들어오는 브라우저(크롬북 등)가 있어, 방금 펜이 닿은 위치의 터치는 펜으로 본다.
 */
const PEN_ACTIVE_WINDOW_MS = 700;
/** 펜 포인터와 그 펜이 만든 터치는 같은 좌표로 들어온다. 손바닥은 펜 끝에서 이보다 멀다. */
const PEN_TOUCH_MATCH_PX = 8;

let penDetected = false;
let lastPenAt = 0;
let lastPenX = Number.NaN;
let lastPenY = Number.NaN;

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
    lastPenX = event.clientX;
    lastPenY = event.clientY;
  };

  const blockPointer = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || !isPenActive()) return;
    event.stopPropagation();
    event.preventDefault();
  };

  const blockTouch = (event: TouchEvent): void => {
    if (!isPenActive()) return;
    // Safari는 애플펜슬 접촉을 touchType 'stylus'로 표시한다. 크롬북은 표시가 없어 펜 위치로 가린다.
    const fromStylus = Array.from(event.changedTouches).some(
      (touch) =>
        (touch as Touch & { touchType?: string }).touchType === 'stylus' ||
        Math.hypot(touch.clientX - lastPenX, touch.clientY - lastPenY) <= PEN_TOUCH_MATCH_PX
    );
    if (fromStylus) return;
    event.stopPropagation();
    event.preventDefault();
  };

  window.addEventListener('pointerdown', notePen, { capture: true, passive: true });
  window.addEventListener('pointermove', notePen, { capture: true, passive: true });
  window.addEventListener('pointerup', notePen, { capture: true, passive: true });
  window.addEventListener('pointerdown', blockPointer, { capture: true });
  window.addEventListener('pointerup', blockPointer, { capture: true });
  window.addEventListener('touchstart', blockTouch, { capture: true, passive: false });
  window.addEventListener('touchend', blockTouch, { capture: true, passive: false });
};
