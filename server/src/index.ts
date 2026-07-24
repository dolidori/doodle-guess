import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { loadConfig, type ServerConfig } from './config.js';
import { live, ready } from './http/health.js';
import { serverTime } from './http/serverTime.js';
import { logLifecycle } from './logging/logger.js';
import { startLoadMetrics } from './metrics/loadMetrics.js';
import { Dispatcher } from './protocol/dispatcher.js';
import { RoomRegistry } from './rooms/roomRegistry.js';
import type { ClientConnection } from './rooms/types.js';
import { startHeartbeat } from './websocket/heartbeat.js';
import { isOriginAllowed } from './websocket/origin.js';
import { isRecovered } from './broadcast/backpressure.js';
import { sendDrawingSnapshot } from './drawing/snapshotService.js';

export type RunningServer = {
  httpServer: Server;
  registry: RoomRegistry;
  dispatcher: Dispatcher;
  close: () => Promise<void>;
  port: number;
};

export const startServer = async (
  overrides: Partial<ServerConfig> = {}
): Promise<RunningServer> => {
  const config = { ...loadConfig(), ...overrides };
  const app = express();
  const connections = new Set<ClientConnection>();
  const loadMetrics = process.env.ENABLE_LOAD_METRICS === '1'
    ? startLoadMetrics()
    : null;
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });
  const registry = new RoomRegistry();
  const dispatcher = new Dispatcher(registry);
  app.get('/health/live', live);
  app.get('/health/ready', ready(registry));
  if (loadMetrics) {
    app.get('/health/load-metrics', (_request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.json(loadMetrics.snapshot(connections.size, registry.rooms.size));
    });
  }
  app.get('/api/time', serverTime);

  const clientDist = path.resolve(process.cwd(), 'client/dist');
  app.use(express.static(clientDist, { index: false }));
  app.get(/^(?!\/api\/|\/health\/|\/ws).*/, (_request, response) => {
    response.sendFile(path.join(clientDist, 'index.html'));
  });

  const httpServer = createServer(app);
  const websocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 16 * 1024
  });
  let acceptingUpgrades = true;

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (!acceptingUpgrades || pathname !== '/ws' || !isOriginAllowed(request, config)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (ws) => {
      websocketServer.emit('connection', ws, request);
    });
  });

  websocketServer.on('connection', (ws, request) => {
    const connectionId = randomUUID();
    const connection: ClientConnection = {
      id: connectionId,
      ws,
      ip: config.nodeEnv === 'test'
        ? `test-${connectionId}`
        : request.socket.remoteAddress ?? 'unknown',
      roomCode: null,
      playerId: null,
      lastPongAt: Date.now(),
      needsSnapshot: false,
      overloadedSince: null,
      processedRequestIds: new Map(),
      explicitlyLeft: false
    };
    connections.add(connection);
    ws.on('pong', () => {
      connection.lastPongAt = Date.now();
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        ws.close(1003, '텍스트 JSON만 지원합니다.');
        return;
      }
      const raw = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      void dispatcher.handle(connection, raw);
    });
    ws.on('close', () => {
      connections.delete(connection);
      dispatcher.roomService.disconnect(connection);
    });
    ws.on('error', () => {
      ws.terminate();
    });
  });

  const heartbeat = startHeartbeat(connections);
  const backpressureRecovery = setInterval(() => {
    for (const room of registry.rooms.values()) {
      for (const connection of room.connections.values()) {
        if (isRecovered(connection)) sendDrawingSnapshot(room, connection);
      }
    }
  }, 250);
  backpressureRecovery.unref();
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : config.port;

  const close = async (): Promise<void> => {
    acceptingUpgrades = false;
    loadMetrics?.stop();
    clearInterval(heartbeat);
    clearInterval(backpressureRecovery);
    for (const room of [...registry.rooms.values()]) {
      dispatcher.roomService.closeRoom(room, 'SERVER_SHUTDOWN');
    }
    for (const connection of connections) {
      connection.ws.close(1012, '서버를 종료합니다.');
    }
    websocketServer.close();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      setTimeout(resolve, 5000).unref();
    });
  };

  return { httpServer, registry, dispatcher, close, port };
};

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const running = await startServer();
  logLifecycle('info', 'server_started', { port: running.port });
  const shutdown = async (): Promise<void> => {
    await running.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
