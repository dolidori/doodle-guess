import type { Stroke } from '../../../shared/src/index.js';
import type { AiProvider } from './provider.js';
import { renderStrokesToPng } from './strokeRender.js';

const SYSTEM = [
  'You are a player in a Pictionary-style drawing game played in Korean.',
  'You look at a partially finished doodle and shout out one guess.',
  'Reply with JSON only: {"guess":"<한국어 단어>"}.'
].join(' ');

/**
 * 이 프롬프트에는 제시어가 절대 들어가지 않는다. 서버는 정답을 알고 있지만,
 * 정답을 흘리는 순간 AI는 그림을 보지도 않고 맞히게 된다.
 */
const instruction = (rejected: string[]): string => `What is being drawn? Give one short Korean common noun.

Rules:
- Reply with {"guess":"단어"} and nothing else.
- One word. No sentence, no explanation, no punctuation.
- Answer in Korean.
- The drawing may be unfinished. Make your best guess anyway.${
  rejected.length
    ? `\n- These guesses were already wrong, pick something different: ${rejected.join(', ')}`
    : ''
}`;

/**
 * 지금까지 그려진 그림을 보고 한 단어를 추측한다. 알아볼 수 없으면 null.
 */
export const guessDrawing = async (
  provider: AiProvider,
  strokes: Stroke[],
  rejected: string[]
): Promise<string | null> => {
  const png = renderStrokesToPng(strokes);
  const reply = await provider.askAboutImage(SYSTEM, instruction(rejected), png);
  if (!reply) return null;
  const cleaned = reply.replace(/```[a-z]*\n?/gu, '').replace(/```/gu, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/u);
  let guess = '';
  if (match) {
    try {
      guess = String((JSON.parse(match[0]) as { guess?: unknown }).guess ?? '');
    } catch {
      guess = '';
    }
  }
  // JSON을 못 지키고 단어만 던지는 경우가 있어, 그때는 첫 줄을 그대로 쓴다.
  if (!guess) guess = cleaned.split('\n')[0] ?? '';
  guess = guess.trim().slice(0, 40);
  return guess.length > 0 ? guess : null;
};
