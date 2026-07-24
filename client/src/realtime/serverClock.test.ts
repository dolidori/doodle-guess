// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estimatedServerNow,
  remainingSeconds,
  syncServerClock,
  type ClockAnchor
} from './serverClock.js';

describe('서버 권위 표시 시계', () => {
  afterEach(() => vi.restoreAllMocks());

  it('performance.now anchor로 현재 서버 시각을 추정한다', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1500);
    const anchor: ClockAnchor = {
      serverEpochAtAnchor: 100_000,
      localMonotonicAtAnchor: 1000,
      rttMs: 20
    };
    expect(estimatedServerNow(anchor)).toBe(100_500);
  });

  it('남은 초는 ceil을 사용하고 0 아래로 내려가지 않는다', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const anchor: ClockAnchor = {
      serverEpochAtAnchor: 10_000,
      localMonotonicAtAnchor: 1000,
      rttMs: 0
    };
    expect(remainingSeconds(10_001, anchor)).toBe(1);
    expect(remainingSeconds(11_000, anchor)).toBe(1);
    expect(remainingSeconds(11_001, anchor)).toBe(2);
    expect(remainingSeconds(9000, anchor)).toBe(0);
  });

  it('활성 중 Date.now가 바뀌어도 단조 시계 기준 남은 시간이 역행하지 않는다', () => {
    const anchor: ClockAnchor = {
      serverEpochAtAnchor: 100_000,
      localMonotonicAtAnchor: 1000,
      rttMs: 20
    };
    vi.spyOn(Date, 'now').mockReturnValueOnce(-20_000).mockReturnValueOnce(220_000);
    const monotonic = vi.spyOn(performance, 'now');
    monotonic.mockReturnValueOnce(1500);
    expect(remainingSeconds(110_000, anchor)).toBe(10);
    Date.now();
    monotonic.mockReturnValueOnce(2500);
    expect(remainingSeconds(110_000, anchor)).toBe(9);
    Date.now();
  });

  it('3개 표본 중 최소 RTT를 선택하고 벽시계 급변 표본은 폐기한다', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000).mockReturnValueOnce(1100)
      .mockReturnValueOnce(2000).mockReturnValueOnce(2020)
      .mockReturnValueOnce(3000).mockReturnValueOnce(3300);
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0).mockReturnValueOnce(100)
      .mockReturnValueOnce(200).mockReturnValueOnce(220)
      .mockReturnValueOnce(300).mockReturnValueOnce(320);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ serverReceivedAt: 1040, serverSentAt: 1040 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ serverReceivedAt: 2010, serverSentAt: 2010 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ serverReceivedAt: 3010, serverSentAt: 3010 })
      }));
    const anchor = await syncServerClock(3);
    expect(anchor.rttMs).toBe(20);
    expect(anchor.serverEpochAtAnchor).toBe(2020);
  });
});
