import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * 길이가 다른 문자열을 timingSafeEqual에 그대로 넣으면 예외가 난다. 양쪽을
 * 해시로 눌러 길이를 맞춘 뒤 비교해, 길이 자체가 단서가 되지 않게 한다.
 */
export const passwordMatches = (candidate: string, expected: string): boolean => {
  if (expected.length === 0) return false;
  const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(candidate), digest(expected));
};
