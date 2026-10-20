import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVERBS,
  acceptedAnswersFor,
  contentWords,
  isCorrectGuess
} from '../game/keywordService.js';

const judge = (keyword: string, guess: string): boolean =>
  isCorrectGuess(keyword, acceptedAnswersFor(keyword), guess);

describe('긴 속담은 조사를 빼고 단어로 채점한다 (4어절 이상)', () => {
  const proverb = '가지 많은 나무에 바람 잘 날 없다';

  it('조사를 바꾸거나 빼도 정답이다', () => {
    expect(judge(proverb, '가지 많은 나무가 바람이 잘 날이 없다')).toBe(true);
    expect(judge(proverb, '가지 많은 나무 바람 잘 날 없다')).toBe(true);
  });

  it('띄어쓰기를 안 해도 정답이다', () => {
    expect(judge(proverb, '가지많은나무에바람잘날없다')).toBe(true);
  });

  it('핵심 단어가 하나라도 빠지면 오답이다', () => {
    expect(judge(proverb, '가지 많은 나무에 바람 잘 없다')).toBe(false);
  });

  it('단어 순서가 바뀌면 오답이다', () => {
    expect(judge(proverb, '바람 잘 날 없다 가지 많은 나무에')).toBe(false);
  });

  it('단어를 잔뜩 늘어놓은 아주 긴 글로는 맞힐 수 없다', () => {
    const spam = `가지 많은 나무 바람 잘 날 없다 ${'그리고 또 '.repeat(10)}`;
    expect(judge(proverb, spam)).toBe(false);
  });

  it('핵심 단어는 어절 끝의 조사만 뗀다', () => {
    expect(contentWords('궁지에 몰린 쥐가 고양이를 문다')).toEqual(['궁지', '몰린', '쥐', '고양이', '문다']);
  });

  it('3어절 이하 속담은 지금처럼 글자가 같아야 정답이다', () => {
    const short = DEFAULT_PROVERBS.find((entry) => entry.text.trim().split(/\s+/).length <= 3)!;
    const words = short.text.trim().split(/\s+/);
    // 첫 어절에 조사 하나를 덧붙여 본다 — 별칭에 없으면 오답이어야 한다.
    const changed = [`${words[0]}가`, ...words.slice(1)].join(' ');
    const aliases = acceptedAnswersFor(short.text);
    if (!aliases.includes(changed.replace(/\s/g, ''))) {
      expect(judge(short.text, changed)).toBe(false);
    }
  });

  it('원문과 별칭은 전부 그대로 정답이고, 다른 속담의 표현은 정답이 되지 않는다', () => {
    for (const entry of DEFAULT_PROVERBS) {
      for (const expression of [entry.text, ...(entry.aliases ?? [])]) {
        expect(judge(entry.text, expression), `${entry.text} ← ${expression}`).toBe(true);
      }
    }
    let crossMatches = 0;
    for (const a of DEFAULT_PROVERBS) {
      for (const b of DEFAULT_PROVERBS) {
        if (a === b) continue;
        for (const expression of [b.text, ...(b.aliases ?? [])]) {
          if (judge(a.text, expression)) crossMatches += 1;
        }
      }
    }
    expect(crossMatches).toBe(0);
  });

  it('일반 단어 제시어는 단어 채점을 하지 않는다', () => {
    expect(judge('사과 나무 아래 강아지', '사과나무아래강아지')).toBe(true);
    expect(judge('사과 나무 아래 강아지', '사과가 나무 아래 강아지')).toBe(false);
  });
});
