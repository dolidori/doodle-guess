import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import os from 'node:os';

const MAX_RECORDED_QUEUE_MS = 5_000;
const queueWaitHistogram = new Uint32Array(MAX_RECORDED_QUEUE_MS + 1);
let queueWaitCount = 0;
let queueWaitMaxMs = 0;
let enabled = false;

export const recordQueueWait = (waitMs: number): void => {
  if (!enabled) return;
  const bucket = Math.min(MAX_RECORDED_QUEUE_MS, Math.max(0, Math.ceil(waitMs)));
  queueWaitHistogram[bucket] = (queueWaitHistogram[bucket] ?? 0) + 1;
  queueWaitCount += 1;
  queueWaitMaxMs = Math.max(queueWaitMaxMs, waitMs);
};

const queuePercentile = (percentile: number): number => {
  if (queueWaitCount === 0) return 0;
  const target = Math.ceil(queueWaitCount * percentile);
  let seen = 0;
  for (let index = 0; index < queueWaitHistogram.length; index += 1) {
    seen += queueWaitHistogram[index] ?? 0;
    if (seen >= target) return index;
  }
  return MAX_RECORDED_QUEUE_MS;
};

export type LoadMetrics = ReturnType<ReturnType<typeof startLoadMetrics>['snapshot']>;

export const startLoadMetrics = () => {
  enabled = true;
  queueWaitHistogram.fill(0);
  queueWaitCount = 0;
  queueWaitMaxMs = 0;

  const startedAt = Date.now();
  const startedPerformance = performance.now();
  const startedCpu = process.cpuUsage();
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  let warmupRssBytes: number | null = null;
  let peakRssBytes = process.memoryUsage().rss;

  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    peakRssBytes = Math.max(peakRssBytes, rss);
    if (warmupRssBytes === null && performance.now() - startedPerformance >= 5 * 60_000) {
      warmupRssBytes = rss;
    }
  }, 5_000);
  sampler.unref();

  return {
    snapshot(connections: number, rooms: number) {
      const elapsedMs = Math.max(1, performance.now() - startedPerformance);
      const cpu = process.cpuUsage(startedCpu);
      const cpuMs = (cpu.user + cpu.system) / 1_000;
      const rssBytes = process.memoryUsage().rss;
      peakRssBytes = Math.max(peakRssBytes, rssBytes);
      return {
        startedAt,
        elapsedMs,
        hardware: {
          platform: process.platform,
          architecture: process.arch,
          logicalCpuCount: os.cpus().length,
          totalMemoryBytes: os.totalmem(),
          nodeVersion: process.version
        },
        server: {
          connections,
          rooms,
          cpuAveragePercentOfOneCore: cpuMs / elapsedMs * 100,
          rssBytes,
          peakRssBytes,
          warmupRssBytes,
          rssIncreaseSinceWarmupPercent: warmupRssBytes === null
            ? null
            : (rssBytes - warmupRssBytes) / warmupRssBytes * 100
        },
        eventLoop: {
          p95Ms: eventLoop.percentile(95) / 1_000_000,
          p99Ms: eventLoop.percentile(99) / 1_000_000,
          maxMs: eventLoop.max / 1_000_000
        },
        roomQueue: {
          samples: queueWaitCount,
          p95Ms: queuePercentile(0.95),
          p99Ms: queuePercentile(0.99),
          maxMs: queueWaitMaxMs
        }
      };
    },
    stop() {
      clearInterval(sampler);
      eventLoop.disable();
      enabled = false;
    }
  };
};
