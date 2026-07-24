export type ClockAnchor = {
  serverEpochAtAnchor: number;
  localMonotonicAtAnchor: number;
  rttMs: number;
};

type ClockSample = ClockAnchor & { valid: boolean };

const sampleServerClock = async (signal?: AbortSignal): Promise<ClockSample> => {
  const t0 = Date.now();
  const m0 = performance.now();
  const response = await fetch('/api/time', {
    cache: 'no-store',
    ...(signal ? { signal } : {})
  });
  if (!response.ok) throw new Error('시간 동기화 실패');
  const { serverReceivedAt, serverSentAt } = await response.json() as {
    serverReceivedAt: number;
    serverSentAt: number;
  };
  const t3 = Date.now();
  const m3 = performance.now();
  const values = [t0, m0, t3, m3, serverReceivedAt, serverSentAt];
  const wallElapsed = t3 - t0;
  const monotonicElapsed = m3 - m0;
  const valid = values.every(Number.isFinite) &&
    wallElapsed >= 0 &&
    monotonicElapsed >= 0 &&
    Math.abs(wallElapsed - monotonicElapsed) <= 100;
  const offsetMs = ((serverReceivedAt - t0) + (serverSentAt - t3)) / 2;
  const rttMs = monotonicElapsed - (serverSentAt - serverReceivedAt);
  return {
    valid: valid && Number.isFinite(offsetMs) && Number.isFinite(rttMs) && rttMs >= 0,
    serverEpochAtAnchor: t3 + offsetMs,
    localMonotonicAtAnchor: m3,
    rttMs
  };
};

export const syncServerClock = async (
  sampleCount = 3,
  signal?: AbortSignal
): Promise<ClockAnchor> => {
  const samples: ClockSample[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    try {
      const sample = await sampleServerClock(signal);
      if (sample.valid) samples.push(sample);
    } catch {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    }
  }
  const best = samples.sort((a, b) => a.rttMs - b.rttMs)[0];
  if (!best) throw new Error('유효한 서버 시간 표본이 없습니다.');
  return best;
};

export const estimatedServerNow = (anchor: ClockAnchor): number =>
  anchor.serverEpochAtAnchor + (performance.now() - anchor.localMonotonicAtAnchor);

export const remainingSeconds = (roundEndsAt: number, anchor: ClockAnchor): number =>
  Math.max(0, Math.ceil((roundEndsAt - estimatedServerNow(anchor)) / 1000));
