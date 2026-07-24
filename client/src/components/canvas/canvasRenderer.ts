import {
  ERASER_WIDTH_MULTIPLIER,
  PALETTE,
  STROKE_WIDTHS,
  type Point,
  type Stroke
} from '../../../../shared/src/index.js';

const drawPath = (
  context: CanvasRenderingContext2D,
  points: Point[],
  width: number
): void => {
  if (!points.length) return;
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0]!.x, points[0]!.y, width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
};

export const renderStrokes = (
  canvas: HTMLCanvasElement,
  strokes: Stroke[]
): void => {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of strokes) {
    if (stroke.undone) continue;
    const shortSide = Math.min(width, height);
    context.globalCompositeOperation = stroke.tool === 'ERASER' ? 'destination-out' : 'source-over';
    context.strokeStyle = stroke.color ? PALETTE[stroke.color].hex : '#000';
    context.fillStyle = stroke.color ? PALETTE[stroke.color].hex : '#000';
    const toolMultiplier = stroke.tool === 'ERASER' ? ERASER_WIDTH_MULTIPLIER : 1;
    context.lineWidth = Math.max(
      ratio,
      STROKE_WIDTHS[stroke.width] * shortSide * toolMultiplier
    );
    const points = stroke.points.map((point) => ({ x: point.x * width, y: point.y * height }));
    drawPath(context, points, context.lineWidth);
  }
  context.globalCompositeOperation = 'source-over';
};

export const renderPreview = (
  canvas: HTMLCanvasElement,
  points: Point[],
  tool: Stroke['tool'],
  color: Stroke['color'],
  strokeWidth: Stroke['width']
): void => {
  renderStrokes(canvas, points.length ? [{
    strokeId: 'preview',
    authorId: 'preview',
    roundId: 'preview',
    drawingRevision: 0,
    drawerEpoch: 0,
    tool,
    color,
    width: strokeWidth,
    points,
    finalized: false,
    lastBatchSeq: 0,
    undone: false,
    createdAt: 0
  }] : []);
};
