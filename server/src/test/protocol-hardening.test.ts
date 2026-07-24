import { describe, expect, it } from 'vitest';
import { QUEUE_CAPACITY } from '../../../shared/src/index.js';
import { RateLimiter } from '../protocol/rateLimit.js';
import { RoomCommandQueue } from '../rooms/roomCommandQueue.js';

describe('rate limit과 방 큐', () => {
  it('추측 burst 8개 뒤 9번째를 거부하고 시간 경과 후 다시 허용한다', () => {
    const limiter = new RateLimiter();
    for (let index = 0; index < 8; index += 1) {
      expect(limiter.take('connection:one', 'SUBMIT_GUESS', 1000)).toBe(true);
    }
    expect(limiter.take('connection:one', 'SUBMIT_GUESS', 1000)).toBe(false);
    expect(limiter.take('connection:one', 'SUBMIT_GUESS', 1250)).toBe(true);
    expect(limiter.take('connection:other', 'SUBMIT_GUESS', 1000)).toBe(true);
  });

  it('제시어 다시 뽑기를 0.35초 간격으로 반복해도 허용한다', () => {
    const limiter = new RateLimiter();
    for (let index = 0; index < 10; index += 1) {
      expect(limiter.take('connection:one', 'SHUFFLE_KEYWORD', 1000 + index * 350))
        .toBe(true);
    }
  });

  it('방 큐가 200개 차면 다음 요청에 SERVER_BUSY를 반환한다', async () => {
    const queue = new RoomCommandQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const accepted = Array.from({ length: QUEUE_CAPACITY }, () => queue.enqueue(() => gate));
    expect(queue.size).toBe(QUEUE_CAPACITY);
    await expect(queue.enqueue(() => undefined))
      .rejects.toMatchObject({ code: 'SERVER_BUSY' });
    release();
    await Promise.all(accepted);
    expect(queue.size).toBe(0);
  });
});
