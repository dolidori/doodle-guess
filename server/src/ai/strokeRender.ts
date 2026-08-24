import { createCanvas } from '@napi-rs/canvas';
import {
  ERASER_WIDTH_MULTIPLIER,
  PALETTE,
  STROKE_WIDTHS,
  type Point,
  type Stroke
} from '../../../shared/src/index.js';

/**
 * 비전 모델은 이미지를 어차피 작게 줄여서 본다. 캔버스를 크게 잡아 봐야 토큰만
 * 쓰므로, 선이 뭉개지지 않을 만큼만 키운다.
 */
const CANVAS_SIZE = 512;

const drawPath = (
  context: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  points: Point[],
  lineWidth: number
): void => {
  if (!points.length) return;
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0]!.x, points[0]!.y, lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
};

/**
 * 참여자들이 보는 것과 같은 그림을 PNG로 만든다. 클라이언트 렌더러와 같은
 * 규칙(정규화 좌표, 짧은 변 기준 굵기, 지우개는 파내기)을 따른다.
 */
export const renderStrokesToPng = (strokes: Stroke[]): Buffer => {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const context = canvas.getContext('2d');
  // 캔버스는 기본이 투명이다. 흰 바탕을 깔지 않으면 검은 선이 검은 배경에
  // 묻혀 모델이 아무것도 보지 못한다.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const stroke of strokes) {
    if (stroke.undone || stroke.points.length === 0) continue;
    context.globalCompositeOperation = stroke.tool === 'ERASER' ? 'destination-out' : 'source-over';
    const hex = stroke.color ? PALETTE[stroke.color].hex : '#111827';
    context.strokeStyle = hex;
    context.fillStyle = hex;
    const toolMultiplier = stroke.tool === 'ERASER' ? ERASER_WIDTH_MULTIPLIER : 1;
    context.lineWidth = Math.max(1, STROKE_WIDTHS[stroke.width] * CANVAS_SIZE * toolMultiplier);
    drawPath(
      context,
      stroke.points.map((point) => ({ x: point.x * CANVAS_SIZE, y: point.y * CANVAS_SIZE })),
      context.lineWidth
    );
  }
  context.globalCompositeOperation = 'source-over';
  // 지우개는 배경까지 파내므로, 뚫린 자리를 다시 흰색으로 덮어 준다.
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  context.globalCompositeOperation = 'source-over';
  return canvas.toBuffer('image/png');
};
