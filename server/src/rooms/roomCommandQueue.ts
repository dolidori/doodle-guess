import { QUEUE_CAPACITY } from '../../../shared/src/index.js';
import { performance } from 'node:perf_hooks';
import { recordQueueWait } from '../metrics/loadMetrics.js';
import { ProtocolError } from '../protocol/errors.js';

export class RoomCommandQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    if (this.pending >= QUEUE_CAPACITY) {
      return Promise.reject(new ProtocolError('SERVER_BUSY', '방이 잠시 혼잡합니다.'));
    }
    this.pending += 1;
    const enqueuedAt = performance.now();
    const result = this.tail.then(() => {
      recordQueueWait(performance.now() - enqueuedAt);
      return task();
    });
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result.finally(() => {
      this.pending -= 1;
    });
  }

  get size(): number {
    return this.pending;
  }
}
