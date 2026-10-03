import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROVERB_LEVELS, type KeywordSource, type ProverbLevel } from '../../../shared/src/index.js';

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
  difficulty: ProverbLevel;
  /** 같은 속담의 다른 표현. 이 중 하나만 맞혀도 정답이다(정답 공개는 text 하나). */
  aliases?: string[];
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

/** 방 설정에 맞는 제시어 풀. 속담은 고른 난이도들로 좁힌다. */
export const keywordPool = (
  source: KeywordSource,
  levels: readonly ProverbLevel[] = PROVERB_LEVELS
): string[] => {
  if (source !== 'PROVERB') return DEFAULT_KEYWORDS;
  const pool = DEFAULT_PROVERBS.filter((entry) => levels.includes(entry.difficulty));
  // 난이도를 좁혀도 풀이 비지 않는다(각 난이도에 36개 이상). 방어적으로 전체를 돌려준다.
  return (pool.length ? pool : DEFAULT_PROVERBS).map((entry) => entry.text);
};

export const pickRandomKeyword = (
  excluded: string | null = null,
  source: KeywordSource = 'WORD',
  levels: readonly ProverbLevel[] = PROVERB_LEVELS
): string => {
  const pool = keywordPool(source, levels);
  const candidates = excluded && pool.length > 1
    ? pool.filter((keyword) => keyword !== excluded)
    : pool;
  return candidates[randomInt(0, candidates.length)]!;
};

// 정답 비교는 글자만 본다. 공백에 더해 구두점(\p{P})과 기호(\p{S})를 지워
// '사과, 배!'와 '사과 배'를 같은 답으로 취급한다.
export const normalizeGuess = (value: string): string =>
  value.replace(/[\s\p{P}\p{S}]/gu, '');

/** 제시어 원문 → 정답으로 인정하는 표현들(정규화). 속담 목록에 있는 제시어만 다른 표현이 붙는다. */
const PROVERB_ANSWERS = new Map(
  DEFAULT_PROVERBS.map((entry) => [
    entry.text,
    [...new Set([entry.text, ...(entry.aliases ?? [])].map(normalizeGuess))]
  ])
);

/**
 * 이 제시어로 시작한 라운드에서 정답으로 인정할 표현들.
 * 속담은 표현이 여러 가지라 같은 속담의 다른 표현도 인정한다. 담당자가 직접 쓴 제시어는 그 글자만.
 */
export const acceptedAnswersFor = (keyword: string): string[] =>
  PROVERB_ANSWERS.get(keyword.trim()) ?? [normalizeGuess(keyword)];
