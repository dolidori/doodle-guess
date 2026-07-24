import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS
} from '../../../shared/src/index.js';
import type { ClientConnection } from '../rooms/types.js';

export const startHeartbeat = (
  connections: Set<ClientConnection>
): NodeJS.Timeout => {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const connection of connections) {
      if (now - connection.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
        connection.ws.terminate();
        continue;
      }
      try {
        connection.ws.ping();
      } catch {
        connection.ws.terminate();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return timer;
};
