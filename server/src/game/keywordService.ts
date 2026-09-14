import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KeywordSource, ProverbDifficulty } from '../../../shared/src/index.js';

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

type ProverbEntry = {
  id: number;
  text: string;
  difficulty: Exclude<ProverbDifficulty, 'ALL'>;
};

const loadProverbs = (): ProverbEntry[] => {
  const path = resolve(process.cwd(), 'server/data/proverbs.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { proverbs?: ProverbEntry[] };
  if (!Array.isArray(parsed.proverbs)) throw new Error('속담 proverbs 배열이 없습니다.');
  const proverbs = parsed.proverbs
    .map((entry) => ({ ...entry, text: entry.text.trim() }))
    .filter((entry) => entry.text);
  if (!proverbs.length || new Set(proverbs.map((entry) => entry.text)).size !== proverbs.length) {
    throw new Error('속담이 비어 있거나 중복되었습니다.');
  }
  return proverbs;
};

export const DEFAULT_KEYWORDS = loadKeywords();
export const DEFAULT_PROVERBS = loadProverbs();

/** 방 설정에 맞는 제시어 풀. 속담은 난이도로 좁힐 수 있다. */
export const keywordPool = (
  source: KeywordSource,
  difficulty: ProverbDifficulty
): string[] => {
  if (source !== 'PROVERB') return DEFAULT_KEYWORDS;
  const pool = difficulty === 'ALL'
    ? DEFAULT_PROVERBS
    : DEFAULT_PROVERBS.filter((entry) => entry.difficulty === difficulty);
  // 난이도를 좁혀도 풀이 비지 않는다(각 난이도에 36개 이상). 방어적으로 전체를 돌려준다.
  return (pool.length ? pool : DEFAULT_PROVERBS).map((entry) => entry.text);
};

export const pickRandomKeyword = (
  excluded: string | null = null,
  source: KeywordSource = 'WORD',
  difficulty: ProverbDifficulty = 'ALL'
): string => {
  const pool = keywordPool(source, difficulty);
  const candidates = excluded && pool.length > 1
    ? pool.filter((keyword) => keyword !== excluded)
    : pool;
  return candidates[randomInt(0, candidates.length)]!;
};

// 정답 비교는 글자만 본다. 공백에 더해 구두점(\p{P})과 기호(\p{S})를 지워
// '사과, 배!'와 '사과 배'를 같은 답으로 취급한다.
export const normalizeGuess = (value: string): string =>
  value.replace(/[\s\p{P}\p{S}]/gu, '');
