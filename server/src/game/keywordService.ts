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

// ─── 긴 속담의 단어 채점 (2026-10-20 대표님 요청) ─────────────────────
// 4어절 이상인 속담은 조사를 뗀 핵심 단어가 **순서대로 모두** 들어 있으면 정답이다.
// '가지 많은 나무에 바람 잘 날 없다' → 가지·많은·나무·바람·잘·날·없다
// 조사를 붙이거나 빼거나 띄어쓰기를 안 해도 맞는다. 끝맺음(없다/없지)은 조사가 아니라 별칭이 맡는다.

/** 단어 채점을 쓰는 최소 어절 수. 짧은 속담은 단어가 적어 느슨하게 보면 엉뚱한 답도 맞는다. */
export const WORD_JUDGING_MIN_EOJEOL = 4;

/** 어절 끝에서 떼는 조사. 긴 것부터 맞춘다('에서'를 '서'보다 먼저). */
const PARTICLES = [
  '에서는', '에게서', '으로는', '이라도', '이나마', '까지도', '에서도',
  '에서', '에게', '에는', '으로', '이라', '부터', '까지', '마저', '조차', '처럼', '보다', '라도', '이나', '만큼', '한테',
  '은', '는', '이', '가', '을', '를', '에', '의', '도', '로', '와', '과', '만', '엔', '랑'
].sort((a, b) => b.length - a.length);

/** 어절 하나에서 조사를 뗀다. 다 떼어 빈 글자가 되면 원래 어절을 둔다(예: '가' 한 글자). */
const stripParticle = (word: string): string => {
  for (const particle of PARTICLES) {
    if (word.length > particle.length && word.endsWith(particle)) return word.slice(0, -particle.length);
  }
  return word;
};

const eojeolCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** 조사를 뗀 핵심 단어 목록. */
export const contentWords = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/)
    .map(normalizeGuess)
    .filter(Boolean)
    .map(stripParticle);

type WordSequence = { words: string[]; length: number };

/** 속담 원문 → 단어 채점에 쓰는 표현들(4어절 이상인 원문·별칭만). */
const PROVERB_WORD_SEQUENCES = new Map(
  DEFAULT_PROVERBS.map((entry) => [
    entry.text,
    [entry.text, ...(entry.aliases ?? [])]
      .filter((expression) => eojeolCount(expression) >= WORD_JUDGING_MIN_EOJEOL)
      .map((expression): WordSequence => ({
        words: contentWords(expression),
        length: normalizeGuess(expression).length
      }))
  ])
);

const containsInOrder = (haystack: string, words: readonly string[]): boolean => {
  let from = 0;
  for (const word of words) {
    const at = haystack.indexOf(word, from);
    if (at < 0) return false;
    from = at + word.length;
  }
  return true;
};

/**
 * 추측이 정답인가. 글자가 정답·별칭과 같으면 정답이고, 긴 속담은 단어 채점도 한다.
 * 단어만 늘어놓은 아주 긴 글로 맞히지 못하게 길이는 원래 표현의 1.5배까지만 본다.
 */
export const isCorrectGuess = (keyword: string, acceptedAnswers: readonly string[], guess: string): boolean => {
  const normalized = normalizeGuess(guess);
  if (normalized.length === 0) return false;
  if (acceptedAnswers.includes(normalized)) return true;
  const sequences = PROVERB_WORD_SEQUENCES.get(keyword.trim());
  if (sequences === undefined) return false;
  return sequences.some(
    ({ words, length }) => normalized.length <= Math.ceil(length * 1.5) && containsInOrder(normalized, words)
  );
};
