type Bucket = { tokens: number; updatedAt: number };

const RULES: Record<string, { ratePerMs: number; burst: number }> = {
  CREATE_ROOM: { ratePerMs: 5 / 60_000, burst: 5 },
  JOIN_ROOM: { ratePerMs: 10 / 60_000, burst: 10 },
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

/**
 * IP는 방 하나를 함께 쓰는 참여자 전원이 공유할 수 있다(교실·사무실 NAT, 모바일 CGNAT).
 * 따라서 IP 버킷은 개인의 연타를 막는 용도가 아니라 한 회선 전체의 총량만 제한하는
 * 보조 장치다. 개인 단위 억제는 연결별 RULES 버킷이 담당한다.
 * ROOM_CAPACITY(30)명이 동시에 들어오고 각자 몇 차례 재접속해도 남도록 잡는다.
 */
const SHARED_IP_RULES: Record<string, { ratePerMs: number; burst: number }> = {
  CREATE_ROOM: { ratePerMs: 30 / 60_000, burst: 30 },
  JOIN_ROOM: { ratePerMs: 120 / 60_000, burst: 60 }
};

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  take(key: string, eventType: string, now = Date.now(), rules = RULES): boolean {
    if (process.env.E2E_DISABLE_RATE_LIMIT === '1') return true;
    const rule = rules[eventType];
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

  takeSharedIp(ip: string, eventType: string, now = Date.now()): boolean {
    return this.take(`ip:${ip}`, eventType, now, SHARED_IP_RULES);
  }

  clearPrefix(key: string): void {
    for (const bucketKey of this.buckets.keys()) {
      if (bucketKey.startsWith(`${key}:`)) this.buckets.delete(bucketKey);
    }
  }
}
