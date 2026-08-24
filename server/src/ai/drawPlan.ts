import {
  PALETTE,
  STROKE_WIDTHS,
  type PaletteColor,
  type Point,
  type StrokeWidth
} from '../../../shared/src/index.js';
import type { AiProvider } from './provider.js';

export type PlannedStroke = {
  color: PaletteColor;
  width: StrokeWidth;
  points: Point[];
};

/** 한 장에 담을 획 수. 많을수록 오래 걸리고 응답이 잘릴 위험도 커진다. */
const MAX_PLANNED_STROKES = 14;
const MAX_POINTS_PER_PLANNED_STROKE = 24;
const MIN_SUGGESTED_STROKES = 4;

const COLORS = Object.keys(PALETTE) as PaletteColor[];
const WIDTHS = Object.keys(STROKE_WIDTHS) as StrokeWidth[];

const SYSTEM = [
  'You draw simple doodles as polylines on a square canvas for a Pictionary-style game.',
  'The canvas is normalized: x and y both run from 0.0 (top-left) to 1.0 (bottom-right).',
  'Reply with JSON only. No prose, no markdown.'
].join(' ');

const instruction = (keyword: string): string => `Draw "${keyword}" as a recognizable line doodle.

Rules:
- Reply with {"strokes":[{"color":"BLACK","width":"MEDIUM","points":[[x,y],...]},...]}
- color must be one of: ${COLORS.join(', ')}
- width must be one of: ${WIDTHS.join(', ')}
- Every x and y must be between 0.0 and 1.0, rounded to 2 decimals.
- Use ${MIN_SUGGESTED_STROKES} to ${MAX_PLANNED_STROKES} strokes, 3 to ${MAX_POINTS_PER_PLANNED_STROKE} points each.
- Each stroke is one continuous pen line. Lift the pen by starting a new stroke.
- Approximate curves and circles with several short segments, not with a few long ones.
- Fill the canvas: keep the drawing roughly between 0.15 and 0.85 on both axes.
- Draw the outline first, then key details. Prefer bold, simple shapes over fine detail.
- Do not write any letters, numbers, or words in the drawing.`;

type RawPlan = {
  strokes?: Array<{
    color?: unknown;
    width?: unknown;
    points?: unknown;
  }>;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * 모델이 보낸 계획을 프로토콜이 받아들일 수 있는 형태로 다듬는다. 범위를 벗어난
 * 좌표는 잘라 넣고, 알아볼 수 없는 항목은 버린다. 서버가 자기 자신에게 보내는
 * 그림이라도 검증 없이 통과시키면 스트로크 검증기에 걸려 라운드가 멈춘다.
 */
export const sanitizePlan = (raw: unknown): PlannedStroke[] => {
  const plan = raw as RawPlan | null;
  if (!plan || !Array.isArray(plan.strokes)) return [];
  const strokes: PlannedStroke[] = [];

  for (const candidate of plan.strokes.slice(0, MAX_PLANNED_STROKES)) {
    if (!Array.isArray(candidate?.points)) continue;
    const points: Point[] = [];
    for (const point of candidate.points.slice(0, MAX_POINTS_PER_PLANNED_STROKE)) {
      // [x, y] 형태와 {x, y} 형태를 모두 받아 준다. 모델이 둘을 섞어 쓴다.
      const pair = Array.isArray(point)
        ? { x: Number(point[0]), y: Number(point[1]) }
        : { x: Number((point as Point)?.x), y: Number((point as Point)?.y) };
      if (!Number.isFinite(pair.x) || !Number.isFinite(pair.y)) continue;
      points.push({ x: clamp01(pair.x), y: clamp01(pair.y) });
    }
    if (points.length === 0) continue;
    const color = COLORS.includes(candidate.color as PaletteColor)
      ? (candidate.color as PaletteColor)
      : 'BLACK';
    const width = WIDTHS.includes(candidate.width as StrokeWidth)
      ? (candidate.width as StrokeWidth)
      : 'MEDIUM';
    strokes.push({ color, width, points });
  }
  return strokes;
};

/** 제시어를 받아 그릴 선을 계획한다. 실패하면 빈 배열. */
export const planDrawing = async (
  provider: AiProvider,
  keyword: string
): Promise<PlannedStroke[]> => {
  const raw = await provider.askJson<RawPlan>(SYSTEM, instruction(keyword));
  return sanitizePlan(raw);
};
