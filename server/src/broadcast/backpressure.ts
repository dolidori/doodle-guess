import WebSocket from 'ws';
import {
  FAILED_CONNECTION_BYTES,
  RECOVERED_CONNECTION_BYTES,
  SLOW_CONNECTION_BYTES
} from '../../../shared/src/index.js';
import type { ClientConnection } from '../rooms/types.js';

export const canSendDrawingDelta = (connection: ClientConnection, now = Date.now()): boolean => {
  if (connection.ws.bufferedAmount >= FAILED_CONNECTION_BYTES) {
    connection.overloadedSince ??= now;
    if (now - connection.overloadedSince >= 5000) {
      connection.ws.close(1013, '연결이 너무 느립니다.');
    }
  } else {
    connection.overloadedSince = null;
  }
  if (connection.ws.bufferedAmount >= SLOW_CONNECTION_BYTES) {
    connection.needsSnapshot = true;
    return false;
  }
  return true;
};

export const isRecovered = (connection: ClientConnection): boolean =>
  connection.needsSnapshot &&
  connection.ws.readyState === WebSocket.OPEN &&
  connection.ws.bufferedAmount < RECOVERED_CONNECTION_BYTES;
