import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from '../../../shared/src/index.js';
import { startServer, type RunningServer } from '../index.js';
import type { ClientConnection } from '../rooms/types.js';
import { startHeartbeat } from '../websocket/heartbeat.js';

describe('HTTP·WebSocket 운영 경계', () => {
  let running: RunningServer | undefined;

  afterEach(async () => {
    await running?.close();
    running = undefined;
    vi.useRealTimers();
  });

  it('/api/time은 no-store Unix ms만 제공하고 보안 헤더를 설정한다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const response = await fetch(`http://127.0.0.1:${running.port}/api/time`);
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(Object.keys(body).sort()).toEqual(['serverReceivedAt', 'serverSentAt']);
    expect(Number.isFinite(body.serverReceivedAt)).toBe(true);
    expect(Number.isFinite(body.serverSentAt)).toBe(true);
  });

  it('production WebSocket은 allowlist origin만 허용한다', async () => {
    running = await startServer({
      port: 0,
      host: '127.0.0.1',
      nodeEnv: 'production',
      allowedOrigins: new Set(['https://game.example'])
    });
    const url = `ws://127.0.0.1:${running.port}/ws`;
    const rejectedStatus = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(url, { origin: 'https://evil.example' });
      socket.once('unexpected-response', (_request, response) => {
        const status = response.statusCode ?? 0;
        response.destroy();
        resolve(status);
      });
      socket.once('error', reject);
    });
    expect(rejectedStatus).toBe(403);

    const allowed = new WebSocket(url, { origin: 'https://game.example' });
    await new Promise<void>((resolve, reject) => {
      allowed.once('open', resolve);
      allowed.once('error', reject);
    });
    allowed.close();
  });

  it('heartbeat timeout 연결만 terminate한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T00:00:00Z'));
    const expired = {
      lastPongAt: Date.now() - HEARTBEAT_TIMEOUT_MS - 1,
      ws: { terminate: vi.fn(), ping: vi.fn() }
    } as unknown as ClientConnection;
    const healthy = {
      lastPongAt: Date.now(),
      ws: { terminate: vi.fn(), ping: vi.fn() }
    } as unknown as ClientConnection;
    const timer = startHeartbeat(new Set([expired, healthy]));
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(expired.ws.terminate).toHaveBeenCalledOnce();
    expect(expired.ws.ping).not.toHaveBeenCalled();
    expect(healthy.ws.ping).toHaveBeenCalledOnce();
    clearInterval(timer);
  });

  it('잘못된 JSON은 ERROR, binary와 16KiB 초과 frame은 close code로 거부한다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const url = `ws://127.0.0.1:${running.port}/ws`;
    const connect = async (): Promise<WebSocket> => {
      const socket = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      return socket;
    };

    const invalid = await connect();
    invalid.send('{invalid');
    const error = await new Promise<{ type: string; payload: { code: string } }>((resolve) => {
      invalid.once('message', (raw) => resolve(JSON.parse(raw.toString()) as {
        type: string;
        payload: { code: string };
      }));
    });
    expect(error.type).toBe('ERROR');
    expect(error.payload.code).toBe('INVALID_JSON');
    invalid.close();

    const binary = await connect();
    const binaryClosed = new Promise<number>((resolve) => {
      binary.once('close', (code) => resolve(code));
    });
    binary.send(Buffer.from([1, 2, 3]));
    expect(await binaryClosed).toBe(1003);

    const oversized = await connect();
    const oversizedClosed = new Promise<number>((resolve) => {
      oversized.once('close', (code) => resolve(code));
    });
    oversized.send('x'.repeat(16 * 1024 + 1));
    expect(await oversizedClosed).toBe(1009);
  });

  it('graceful shutdown에서 열린 WebSocket을 1012로 닫는다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const socket = new WebSocket(`ws://127.0.0.1:${running.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const closed = new Promise<number>((resolve) => {
      socket.once('close', (code) => resolve(code));
    });
    await running.close();
    running = undefined;
    expect(await closed).toBe(1012);
  });
});
