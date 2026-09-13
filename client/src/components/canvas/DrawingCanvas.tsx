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

const normalizedPoint = (event: React.PointerEvent, element: HTMLElement): Point | null => {
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

  const addPoint = (event: React.PointerEvent<HTMLDivElement>, force = false): void => {
    const active = activeRef.current;
    if (!active || event.pointerId !== active.pointerId || !stageRef.current) return;
    const now = performance.now();
    if (!force && now - active.lastSampleAt < 16) return;
    const point = normalizedPoint(event, stageRef.current);
    if (!point || active.preview.length >= 2048) return;
    active.lastSampleAt = now;
    active.pending.push(point);
    active.preview.push(point);
    redraw();
  };

  const finish = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = activeRef.current;
    if (!active || event.pointerId !== active.pointerId) return;
    addPoint(event, true);
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
          lastSampleAt: performance.now(),
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
        addPoint(event);
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
