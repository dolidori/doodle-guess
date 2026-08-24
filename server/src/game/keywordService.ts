import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type KeywordEntry = {
  id: number;
  text: string;
  category?: string;
  difficulty?: number;
};

const loadKeywords = (): string[] => {
  const path = resolve(process.cwd(), 'server/data/keywords.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { words?: KeywordEntry[] };
  if (!Array.isArray(parsed.words)) throw new Error('제시어 words 배열이 없습니다.');
  const words = parsed.words.map((entry) => entry.text.trim()).filter(Boolean);
  if (!words.length || new Set(words).size !== words.length) {
    throw new Error('제시어가 비어 있거나 중복되었습니다.');
  }
  return words;
};

export const DEFAULT_KEYWORDS = loadKeywords();

export const pickRandomKeyword = (excluded: string | null = null): string => {
  const candidates = excluded && DEFAULT_KEYWORDS.length > 1
    ? DEFAULT_KEYWORDS.filter((keyword) => keyword !== excluded)
    : DEFAULT_KEYWORDS;
  return candidates[randomInt(0, candidates.length)]!;
};

// 정답 비교는 글자만 본다. 공백에 더해 구두점(\p{P})과 기호(\p{S})를 지워
// '사과, 배!'와 '사과 배'를 같은 답으로 취급한다.
export const normalizeGuess = (value: string): string =>
  value.replace(/[\s\p{P}\p{S}]/gu, '');
