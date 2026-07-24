import { useCallback, useEffect, useRef } from 'react';
import {
  ERASER_WIDTH_MULTIPLIER,
  STROKE_WIDTHS,
  type Point
} from '../../../../shared/src/index.js';
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
    const active = activeRef.current;
    if (previewRef.current) {
      renderPreview(
        previewRef.current,
        active?.preview ?? [],
        settingsRef.current.tool,
        settingsRef.current.tool === 'PEN' ? settingsRef.current.color : null,
        settingsRef.current.width
      );
    }
  }, []);

  useEffect(() => {
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
    const timer = window.setInterval(() => flush(false), 50);
    return () => clearInterval(timer);
  }, [flush]);

  useEffect(() => {
    if (enabled) return;
    activeRef.current = null;
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
    if (!activeRef.current || event.pointerId !== activeRef.current.pointerId) return;
    addPoint(event, true);
    if (activeRef.current.pending.length === 0 && activeRef.current.preview.length) {
      activeRef.current.pending.push(activeRef.current.preview.at(-1)!);
    }
    flush(true);
    stageRef.current?.releasePointerCapture(event.pointerId);
    activeRef.current = null;
    if (previewRef.current) {
      renderPreview(previewRef.current, [], settings.tool, settings.tool === 'PEN' ? settings.color : null, settings.width);
    }
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
        lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
        syncEraserCursor();
        const point = normalizedPoint(event, stageRef.current);
        if (!point) return;
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
        lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
        syncEraserCursor();
      }}
      onPointerMove={(event) => {
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
