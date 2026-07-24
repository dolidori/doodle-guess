import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ServerEnvelope, type ServerEventType } from '../../../shared/src/index.js';
import type { ClientConnection, RoomRuntime } from '../rooms/types.js';
import { canSendDrawingDelta } from './backpressure.js';

export const sendEnvelope = (
  connection: ClientConnection,
  envelope: ServerEnvelope,
  drawingDelta = false
): boolean => {
  if (connection.ws.readyState !== WebSocket.OPEN) return false;
  if (drawingDelta && !canSendDrawingDelta(connection)) return false;
  try {
    connection.ws.send(JSON.stringify(envelope));
    return true;
  } catch {
    connection.ws.terminate();
    return false;
  }
};

export const envelope = (
  type: ServerEventType,
  payload: unknown,
  metadata: Omit<ServerEnvelope, 'v' | 'type' | 'payload'> = {}
): ServerEnvelope => ({
  v: PROTOCOL_VERSION,
  type,
  ...metadata,
  payload
});

export const broadcast = (
  room: RoomRuntime,
  event: ServerEnvelope,
  drawingDelta = false,
  exceptPlayerId?: string
): void => {
  for (const [playerId, connection] of room.connections) {
    if (playerId !== exceptPlayerId) sendEnvelope(connection, event, drawingDelta);
  }
};
