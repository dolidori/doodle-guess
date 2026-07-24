type Bucket = { tokens: number; updatedAt: number };

const RULES: Record<string, { ratePerMs: number; burst: number }> = {
  CREATE_ROOM: { ratePerMs: 5 / 60_000, burst: 5 },
  JOIN_ROOM: { ratePerMs: 5 / 60_000, burst: 5 },
  LEAVE_ROOM: { ratePerMs: 2 / 1000, burst: 2 },
  SET_KEYWORD_AND_START: { ratePerMs: 2 / 10_000, burst: 2 },
  SET_ROUND_DURATION: { ratePerMs: 5 / 10_000, burst: 5 },
  SET_ANSWER_MODE: { ratePerMs: 5 / 10_000, burst: 5 },
  SET_DRAWER_ORDER: { ratePerMs: 5 / 10_000, burst: 5 },
  SHUFFLE_KEYWORD: { ratePerMs: 3 / 1000, burst: 4 },
  SUBMIT_GUESS: { ratePerMs: 4 / 1000, burst: 8 },
  DRAW_STROKE_BATCH: { ratePerMs: 25 / 1000, burst: 40 },
  UNDO_LAST_STROKE: { ratePerMs: 3 / 1000, burst: 5 },
  CLEAR_DRAWING: { ratePerMs: 3 / 1000, burst: 5 },
  ASSIGN_DRAWER: { ratePerMs: 5 / 10_000, burst: 5 },
  RECLAIM_DRAWER: { ratePerMs: 5 / 10_000, burst: 5 },
  KICK_PLAYER: { ratePerMs: 5 / 10_000, burst: 5 },
  START_NEXT_ROUND: { ratePerMs: 5 / 10_000, burst: 5 },
  RETURN_TO_WAITING: { ratePerMs: 5 / 10_000, burst: 5 },
  END_CEREMONY: { ratePerMs: 2 / 10_000, burst: 2 }
};

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  take(key: string, eventType: string, now = Date.now()): boolean {
    if (process.env.E2E_DISABLE_RATE_LIMIT === '1') return true;
    const rule = RULES[eventType];
    if (!rule) return true;
    const bucketKey = `${key}:${eventType}`;
    const previous = this.buckets.get(bucketKey) ?? { tokens: rule.burst, updatedAt: now };
    const tokens = Math.min(
      rule.burst,
      previous.tokens + Math.max(0, now - previous.updatedAt) * rule.ratePerMs
    );
    if (tokens < 1) {
      this.buckets.set(bucketKey, { tokens, updatedAt: now });
      return false;
    }
    this.buckets.set(bucketKey, { tokens: tokens - 1, updatedAt: now });
    return true;
  }

  clearPrefix(key: string): void {
    for (const bucketKey of this.buckets.keys()) {
      if (bucketKey.startsWith(`${key}:`)) this.buckets.delete(bucketKey);
    }
  }
}
