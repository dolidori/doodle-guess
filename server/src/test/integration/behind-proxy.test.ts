import { createServer } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../../index.js';

type Message = { type: string; payload: any };

/** Render 배포의 ALLOWED_ORIGINS와 같은 역할. */
const PUBLIC_ORIGIN = 'https://doodle-guess-9m52.onrender.com';

/**
 * Render는 앱을 로드밸런서 뒤에서 실행한다. 그러면 socket.remoteAddress는 전부
 * 프록시 IP가 되고, 접속자 전원이 하나의 IP로 묶인다. 실제 접속자는 프록시가
 * 붙여 주는 X-Forwarded-For에만 남는다. 그 구조를 그대로 세워서 검증한다.
 */
const startProxy = async (targetPort: number): Promise<{ port: number; close: () => Promise<void> }> => {
  const proxy = createServer();

  // WebSocket 업그레이드를 원본 서버로 그대로 전달하며 X-Forwarded-For를 붙인다.
  proxy.on('upgrade', (request, socket, head) => {
    const forwardedFor = request.headers['x-forwarded-for'];
    const origin = request.headers.origin;
    const upstream = connect(targetPort, '127.0.0.1', () => {
      const headers = [
        `GET ${request.url} HTTP/1.1`,
        `Host: 127.0.0.1:${targetPort}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        `Sec-WebSocket-Key: ${request.headers['sec-websocket-key'] as string}`,
        `Sec-WebSocket-Version: ${request.headers['sec-websocket-version'] as string}`,
        ...(forwardedFor ? [`X-Forwarded-For: ${forwardedFor as string}`] : []),
        ...(origin ? [`Origin: ${origin}`] : []),
        '\r\n'
      ].join('\r\n');
      upstream.write(headers);
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', () => resolve()));
  const address = proxy.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    close: () => new Promise<void>((resolve) => {
      proxy.close(() => resolve());
    })
  };
};

class ProxiedClient {
  private readonly messages: Message[] = [];
  readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => this.messages.push(JSON.parse(data.toString()) as Message));
  }

  /** 프록시를 거쳐 접속한다. clientAddress가 원 접속자 IP 역할을 한다. */
  static async connect(proxyPort: number, clientAddress: string): Promise<ProxiedClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/ws`, {
      headers: { 'x-forwarded-for': clientAddress },
      origin: PUBLIC_ORIGIN
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return new ProxiedClient(ws);
  }

  send(type: string, payload: unknown = {}): void {
    this.ws.send(JSON.stringify({ v: 1, type, requestId: crypto.randomUUID(), payload }));
  }

  async settle(timeoutMs = 5000): Promise<Message> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.messages.findIndex(
        (message) => message.type === 'ROOM_SESSION' || message.type === 'ERROR'
      );
      if (index >= 0) return this.messages.splice(index, 1)[0]!;
      if (Date.now() >= deadline) throw new Error('입장 결과를 기다리다 시간이 초과되었습니다.');
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }

  close(): void {
    this.ws.close();
  }
}

describe('Render처럼 프록시 뒤에 있을 때의 입장', () => {
  let running: RunningServer | undefined;
  let proxy: { port: number; close: () => Promise<void> } | undefined;
  const clients: ProxiedClient[] = [];

  afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    await proxy?.close();
    proxy = undefined;
    await running?.close();
    running = undefined;
  });

  it('프록시 뒤에서도 서로 다른 접속자 25명이 모두 입장한다', async () => {
    running = await startServer({
      port: 0,
      host: '127.0.0.1',
      nodeEnv: 'production',
      trustProxy: true,
      allowedOrigins: new Set([PUBLIC_ORIGIN])
    });
    proxy = await startProxy(running.port);

    const host = await ProxiedClient.connect(proxy.port, '203.0.113.1');
    clients.push(host);
    host.send('CREATE_ROOM', { nickname: '방장', mode: 'NORMAL' });
    const hostSession = await host.settle();
    expect(hostSession.type).toBe('ROOM_SESSION');
    const roomCode = hostSession.payload.roomCode as string;

    // 각자 다른 회선에서 접속하는 25명. 프록시에게는 전부 같은 소켓 주소로 보인다.
    const guests = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        ProxiedClient.connect(proxy!.port, `203.0.113.${index + 10}`)
      )
    );
    clients.push(...guests);
    guests.forEach((guest, index) => {
      guest.send('JOIN_ROOM', { roomCode, nickname: `참여자${index}` });
    });

    const results = await Promise.all(guests.map((guest) => guest.settle()));
    const rejected = results.filter((message) => message.type === 'ERROR');
    expect(
      rejected.map((message) => message.payload.code),
      `프록시 뒤에서 ${rejected.length}명이 거부됨`
    ).toEqual([]);
  });

  it('한 회선에 몰린 참여자 전원(정원 가득)이 입장한다', async () => {
    running = await startServer({
      port: 0,
      host: '127.0.0.1',
      nodeEnv: 'production',
      trustProxy: true,
      allowedOrigins: new Set([PUBLIC_ORIGIN])
    });
    proxy = await startProxy(running.port);

    // 교실 하나가 통째로 같은 공유기를 쓰는 상황: XFF도 전원 동일하다.
    const sharedLine = '203.0.113.77';
    const host = await ProxiedClient.connect(proxy.port, sharedLine);
    clients.push(host);
    host.send('CREATE_ROOM', { nickname: '선생님', mode: 'NORMAL' });
    const roomCode = (await host.settle()).payload.roomCode as string;

    const guests = await Promise.all(
      Array.from({ length: 29 }, () => ProxiedClient.connect(proxy!.port, sharedLine))
    );
    clients.push(...guests);
    guests.forEach((guest, index) => {
      guest.send('JOIN_ROOM', { roomCode, nickname: `학생${index}` });
    });

    const results = await Promise.all(guests.map((guest) => guest.settle()));
    const rejected = results.filter((message) => message.type === 'ERROR');
    expect(
      rejected.map((message) => message.payload.code),
      `같은 회선에서 ${rejected.length}명이 거부됨`
    ).toEqual([]);
  });
});
