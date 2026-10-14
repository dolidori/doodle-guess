import { useCallback, useEffect, useRef } from 'react';
import {
  ERASER_WIDTH_MULTIPLIER,
  STROKE_WIDTHS,
  type Point
} from '../../../../shared/src/index.js';
import { shouldIgnoreTouchDrawing } from '../../input/palmRejection.js';
import { useGame } from '../../state/GameContext.js';
import { renderPreview, renderStrokes } from './canvasRenderer.js';
import type { ToolSettings } from './DrawingToolbar.js';

type ActiveStroke = {
  pointerId: number;
  strokeId: string;
  batchSeq: number;
  pending: Point[];
  preview: Point[];
  lastSampleAt: number;
  settings: ToolSettings;
};

type PointerSample = { pointerId: number; clientX: number; clientY: number; timeStamp: number };

const normalizedPoint = (event: { clientX: number; clientY: number }, element: HTMLElement): Point | null => {
  const rect = element.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000 };
};

export const DrawingCanvas = ({
  enabled,
  settings
}: {
  enabled: boolean;
  settings: ToolSettings;
}) => {
  const { state, send } = useGame();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const eraserCursorRef = useRef<HTMLSpanElement>(null);
  const activeRef = useRef<ActiveStroke | null>(null);
  /**
   * 펜을 뗀 획은 서버 확정본이 올 때까지 미리보기에 남긴다. 바로 지우면 아직
   * 왕복이 끝나지 않은 뒷부분이 사라졌다가 배치 단위로 다시 채워져, 획이 처음부터
   * 다시 그려지는 것처럼 보인다.
   */
  const settlingRef = useRef<{
    strokeId: string;
    drawingRevision: number;
    points: Point[];
    settings: ToolSettings;
  } | null>(null);
  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const settingsRef = useRef(settings);
  const stateRef = useRef(state);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const syncEraserCursor = useCallback((): void => {
    const stage = stageRef.current;
    const cursor = eraserCursorRef.current;
    const pointer = lastPointerRef.current;
    if (!stage || !cursor || !pointer || !enabled || settings.tool !== 'ERASER') {
      if (cursor) cursor.hidden = true;
      return;
    }
    const rect = stage.getBoundingClientRect();
    const diameter = STROKE_WIDTHS[settings.width] *
      ERASER_WIDTH_MULTIPLIER *
      Math.min(rect.width, rect.height);
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.left = `${pointer.clientX - rect.left}px`;
    cursor.style.top = `${pointer.clientY - rect.top}px`;
    cursor.hidden = false;
  }, [enabled, settings.tool, settings.width]);

  useEffect(() => {
    syncEraserCursor();
  }, [syncEraserCursor]);

  const redraw = useCallback((): void => {
    if (canvasRef.current) renderStrokes(canvasRef.current, stateRef.current.drawing.strokes);
    if (!previewRef.current) return;
    const active = activeRef.current;
    // 그리는 중이면 진행 중인 획을, 막 뗐으면 확정 대기 중인 획을 덮어 둔다.
    const overlay = active
      ? { points: active.preview, settings: active.settings }
      : settlingRef.current;
    const settings = overlay?.settings ?? settingsRef.current;
    renderPreview(
      previewRef.current,
      overlay?.points ?? [],
      settings.tool,
      settings.tool === 'PEN' ? settings.color : null,
      settings.width
    );
  }, []);

  useEffect(() => {
    const settling = settlingRef.current;
    if (settling) {
      const confirmed = state.drawing.strokes.find(
        (stroke) => stroke.strokeId === settling.strokeId
      );
      // 확정본이 도착했거나 캔버스가 갈아엎어졌으면 본 캔버스에 넘기고 미리보기를 비운다.
      if (
        state.drawing.drawingRevision !== settling.drawingRevision ||
        confirmed?.finalized ||
        confirmed?.undone
      ) {
        settlingRef.current = null;
      }
    }
    redraw();
  }, [state.drawing, redraw]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [redraw]);

  const flush = useCallback(function flushBatches(isFinal: boolean): void {
    const active = activeRef.current;
    const publicState = stateRef.current.publicState;
    if (!active || !publicState || active.pending.length === 0) return;
    const points = active.pending.splice(0, 64);
    send('DRAW_STROKE_BATCH', {
      roundId: publicState.round.roundId,
      drawingRevision: publicState.drawing.drawingRevision,
      drawerEpoch: publicState.drawerEpoch,
      strokeId: active.strokeId,
      batchSeq: active.batchSeq,
      isFinal: isFinal && active.pending.length === 0,
      tool: active.settings.tool,
      color: active.settings.tool === 'PEN' ? active.settings.color : null,
      width: active.settings.width,
      points
    });
    active.batchSeq += 1;
    if (active.pending.length) flushBatches(isFinal);
  }, [send]);

  useEffect(() => {
    const timer = window.setInterval(() => flush(false), 120);
    return () => clearInterval(timer);
  }, [flush]);

  useEffect(() => {
    if (enabled) return;
    activeRef.current = null;
    settlingRef.current = null;
    redraw();
  }, [enabled, redraw]);

  // 점을 하나 더한다(16ms 간격). 시각은 이벤트 시각으로 잰다 — 묶여 들어온 중간 점(getCoalescedEvents)도 제 시각으로 고른다
  const addPoint = (event: PointerSample, force = false): boolean => {
    const active = activeRef.current;
    if (!active || event.pointerId !== active.pointerId || !stageRef.current) return false;
    const now = event.timeStamp;
    if (!force && now - active.lastSampleAt < 16) return false;
    const point = normalizedPoint(event, stageRef.current);
    if (!point || active.preview.length >= 2048) return false;
    active.lastSampleAt = now;
    active.pending.push(point);
    active.preview.push(point);
    return true;
  };

  // 아이패드: 펜슬로 빠르게 이어 그리면 시스템(손글씨 인식 Scribble·제스처)이 터치 시작을 먼저 가져가
  // 획 첫머리가 늦게 들어오거나 빠진다. 그릴 수 있는 동안 캔버스 위 터치는 브라우저 기본 동작을 막아 곧바로 그림으로 받는다
  // (touch-action: none 만으로는 Scribble 이 끼어든다)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !enabled) return;
    const keepForDrawing = (event: TouchEvent): void => {
      if (event.cancelable) event.preventDefault();
    };
    stage.addEventListener('touchstart', keepForDrawing, { passive: false });
    stage.addEventListener('touchmove', keepForDrawing, { passive: false });
    return () => {
      stage.removeEventListener('touchstart', keepForDrawing);
      stage.removeEventListener('touchmove', keepForDrawing);
    };
  }, [enabled]);

  const finish = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = activeRef.current;
    if (!active || event.pointerId !== active.pointerId) return;
    addPoint(event.nativeEvent, true);
    if (active.pending.length === 0 && active.preview.length) {
      active.pending.push(active.preview.at(-1)!);
    }
    flush(true);
    stageRef.current?.releasePointerCapture(event.pointerId);
    settlingRef.current = {
      strokeId: active.strokeId,
      drawingRevision: stateRef.current.drawing.drawingRevision,
      points: active.preview,
      settings: active.settings
    };
    activeRef.current = null;
    redraw();
  };

  return (
    <div
      ref={stageRef}
      className={[
        'canvas-stage',
        enabled ? 'enabled' : 'locked',
        enabled && settings.tool === 'ERASER' ? 'eraser-active' : ''
      ].filter(Boolean).join(' ')}
      aria-label={enabled ? '그림을 그릴 수 있는 캔버스' : '그림 보기 캔버스'}
      onPointerDown={(event) => {
        if (!enabled || !stageRef.current) return;
        if (shouldIgnoreTouchDrawing(event.pointerType)) return;
        if (activeRef.current) {
          // 진행 중인 획은 다른 포인터가 가로챌 수 없다. 단 펜은 손가락 획을 넘겨받는다.
          if (event.pointerType !== 'pen') return;
          flush(true);
          stageRef.current.releasePointerCapture(activeRef.current.pointerId);
          activeRef.current = null;
        }
        lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
        syncEraserCursor();
        const point = normalizedPoint(event, stageRef.current);
        if (!point) return;
        settlingRef.current = null;
        stageRef.current.setPointerCapture(event.pointerId);
        activeRef.current = {
          pointerId: event.pointerId,
          strokeId: crypto.randomUUID(),
          batchSeq: 0,
          pending: [point],
          preview: [point],
          lastSampleAt: event.timeStamp,
          settings: settingsRef.current
        };
        redraw();
      }}
      onPointerEnter={(event) => {
        if (shouldIgnoreTouchDrawing(event.pointerType)) return;
        lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
        syncEraserCursor();
      }}
      onPointerMove={(event) => {
        if (shouldIgnoreTouchDrawing(event.pointerType)) return;
        lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
        syncEraserCursor();
        // 빠르게 움직이면 브라우저가 여러 점을 한 이벤트로 묶어 보낸다. 묶인 점까지 받아 획(특히 첫머리)이 끊기지 않게 한다
        const native = event.nativeEvent;
        const samples = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
        let added = false;
        for (const sample of samples.length ? samples : [native]) added = addPoint(sample) || added;
        if (added) redraw();
      }}
      onPointerLeave={() => {
        lastPointerRef.current = null;
        if (eraserCursorRef.current) eraserCursorRef.current.hidden = true;
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <canvas ref={canvasRef} />
      <canvas ref={previewRef} className="preview-canvas" />
      <span ref={eraserCursorRef} className="eraser-cursor" hidden aria-hidden="true" />
      {!enabled && <span className="canvas-lock-label">보기 전용</span>}
    </div>
  );
};
