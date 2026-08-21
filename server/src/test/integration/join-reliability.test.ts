import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../../index.js';

type Message = {
  type: string;
  requestId?: string;
  payload: any;
};

/**
 * nodeEnv를 'test'로 두면 index.ts가 연결마다 IP를 test-<uuid>로 위조하므로
 * 같은 공유망(NAT) 시나리오를 재현할 수 없다. 여기서는 실제 remoteAddress를
 * 쓰도록 두어 모든 로컬 연결이 하나의 IP를 공유하게 만든다.
 */
const SHARED_NETWORK_ENV = 'development';

class TestClient {
  private readonly messages: Message[] = [];
  private readonly waiters = new Set<() => void>();
  readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      this.messages.push(JSON.parse(data.toString()) as Message);
      for (const waiter of this.waiters) waiter();
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return new TestClient(ws);
  }

  send(type: string, payload: unknown = {}, requestId: string = crypto.randomUUID()): string {
    this.ws.send(JSON.stringify({ v: 1, type, requestId, payload }));
    return requestId;
  }

  async next(
    type: string,
    predicate: (message: Message) => boolean = () => true,
    timeoutMs = 3000
  ): Promise<Message> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.messages.findIndex((message) => message.type === type && predicate(message));
      if (index >= 0) return this.messages.splice(index, 1)[0]!;
      if (Date.now() >= deadline) {
        throw new Error(`${type} 메시지를 기다리다 시간이 초과되었습니다: ${JSON.stringify(this.messages)}`);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.waiters.delete(wake);
          resolve();
        }, 30);
        const wake = (): void => {
          clearTimeout(timer);
          this.waiters.delete(wake);
          resolve();
        };
        this.waiters.add(wake);
      });
    }
  }

  /**
   * 화면이 꺼진 휴대폰처럼, 소켓은 열려 있지만 더 이상 아무 프레임에도 응답하지
   * 않는 상태를 만든다. 서버는 ping을 보내도 pong을 받지 못한다.
   */
  goSilent(): void {
    (this.ws as unknown as { _socket: { pause: () => void } })._socket.pause();
  }

  /** ROOM_SESSION 또는 ERROR 중 먼저 오는 쪽을 돌려준다. */
  async settleJoin(timeoutMs = 3000): Promise<Message> {
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

describe('같은 공유망에서의 입장 신뢰성', () => {
  let running: RunningServer | undefined;
  const clients: TestClient[] = [];

  afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    await running?.close();
    running = undefined;
  });

  it('같은 IP에서 20명이 연달아 입장해도 전원이 성공한다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: SHARED_NETWORK_ENV });
    const url = `ws://127.0.0.1:${running.port}/ws`;

    const host = await TestClient.connect(url);
    clients.push(host);
    host.send('CREATE_ROOM', { nickname: '방장', mode: 'NORMAL' });
    const hostSession = await host.next('ROOM_SESSION');
    const roomCode = hostSession.payload.roomCode as string;

    const guests = await Promise.all(
      Array.from({ length: 20 }, () => TestClient.connect(url))
    );
    clients.push(...guests);

    guests.forEach((guest, index) => {
      guest.send('JOIN_ROOM', { roomCode, nickname: `참여자${index}` });
    });

    const results = await Promise.all(guests.map((guest) => guest.settleJoin(5000)));
    const rejected = results.filter((message) => message.type === 'ERROR');

    expect(
      rejected.map((message) => message.payload.code),
      `거부된 입장 ${rejected.length}건`
    ).toEqual([]);
  });

  it('같은 IP에서 재입장을 반복해도 레이트리밋으로 막히지 않는다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: SHARED_NETWORK_ENV });
    const url = `ws://127.0.0.1:${running.port}/ws`;

    const host = await TestClient.connect(url);
    clients.push(host);
    host.send('CREATE_ROOM', { nickname: '방장', mode: 'NORMAL' });
    const roomCode = (await host.next('ROOM_SESSION')).payload.roomCode as string;

    // 한 사람이 네트워크가 불안정해 열 번 재접속하는 상황.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const guest = await TestClient.connect(url);
      clients.push(guest);
      guest.send('JOIN_ROOM', { roomCode, nickname: '불안정한참여자' });
      const settled = await guest.settleJoin();
      expect(settled.type, `${attempt + 1}번째 재접속이 거부됨: ${JSON.stringify(settled.payload)}`)
        .toBe('ROOM_SESSION');
      // 서버가 이전 연결의 종료를 인지할 틈을 주지 않고 바로 끊는다.
      guest.ws.terminate();
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    }
  });

  /** 클라이언트의 재시도 정책과 같은 방식으로 입장이 확정될 때까지 다시 시도한다. */
  const joinWithRetry = async (
    client: TestClient,
    payload: Record<string, unknown>,
    maxAttempts = 5
  ): Promise<Message> => {
    let settled: Message | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      client.send('JOIN_ROOM', payload);
      settled = await client.settleJoin();
      if (settled.type === 'ROOM_SESSION' || settled.payload.retryable !== true) return settled;
      await new Promise<void>((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
    return settled!;
  };

  it('유령 연결이 남아 있어도 세션 토큰 재입장이 인계된다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: SHARED_NETWORK_ENV });
    const url = `ws://127.0.0.1:${running.port}/ws`;

    const host = await TestClient.connect(url);
    clients.push(host);
    host.send('CREATE_ROOM', { nickname: '방장', mode: 'NORMAL' });
    const roomCode = (await host.next('ROOM_SESSION')).payload.roomCode as string;

    const guest = await TestClient.connect(url);
    clients.push(guest);
    guest.send('JOIN_ROOM', { roomCode, nickname: '참여자' });
    const guestSession = await guest.next('ROOM_SESSION');
    const sessionToken = guestSession.payload.sessionToken as string;

    // 이전 소켓을 닫지 않고 응답만 끊는다. 모바일 화면 꺼짐처럼 서버가 아직 죽은
    // 연결을 인지하지 못한 상태(최대 90초)와 동일한 서버 상태를 만든다.
    guest.goSilent();

    const revived = await TestClient.connect(url);
    clients.push(revived);
    const settled = await joinWithRetry(revived, {
      roomCode,
      nickname: '참여자',
      sessionToken
    });
    expect(
      settled.type,
      `재입장이 거부됨: ${JSON.stringify(settled.payload)}`
    ).toBe('ROOM_SESSION');
    expect(settled.payload.isReconnect).toBe(true);
  });

  it('살아 있는 연결은 토큰을 가진 다른 접속에게 밀려나지 않는다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: SHARED_NETWORK_ENV });
    const url = `ws://127.0.0.1:${running.port}/ws`;

    const host = await TestClient.connect(url);
    clients.push(host);
    host.send('CREATE_ROOM', { nickname: '방장', mode: 'NORMAL' });
    const roomCode = (await host.next('ROOM_SESSION')).payload.roomCode as string;

    const victim = await TestClient.connect(url);
    clients.push(victim);
    victim.send('JOIN_ROOM', { roomCode, nickname: '피해자' });
    const stolenToken = (await victim.next('ROOM_SESSION')).payload.sessionToken as string;

    // 피해자는 정상 접속 중이다(ping에 pong으로 답한다).
    const thief = await TestClient.connect(url);
    clients.push(thief);
    // 끈질기게 재시도해도 생존 확인을 통과하지 못해야 한다.
    const settled = await joinWithRetry(thief, {
      roomCode,
      nickname: '피해자',
      sessionToken: stolenToken
    }, 3);

    expect(settled.type, '탈취된 토큰으로 정상 접속자를 밀어냈다').toBe('ERROR');
    expect(settled.payload.code).toBe('SESSION_IN_USE');
    expect(victim.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('인계된 연결은 최신 점수가 반영된 PUBLIC_STATE를 받는다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: SHARED_NETWORK_ENV });
    const url = `ws://127.0.0.1:${running.port}/ws`;

    const host = await TestClient.connect(url);
    clients.push(host);
    host.send('CREATE_ROOM', { nickname: '방장', mode: 'NORMAL' });
    const hostSession = await host.next('ROOM_SESSION');
    const roomCode = hostSession.payload.roomCode as string;
    const hostId = hostSession.payload.playerId as string;

    const solver = await TestClient.connect(url);
    clients.push(solver);
    solver.send('JOIN_ROOM', { roomCode, nickname: '정답자' });
    await solver.next('ROOM_SESSION');

    const watcher = await TestClient.connect(url);
    clients.push(watcher);
    watcher.send('JOIN_ROOM', { roomCode, nickname: '관전자' });
    const watcherSession = await watcher.next('ROOM_SESSION');
    const watcherToken = watcherSession.payload.sessionToken as string;

    const state = await host.next('PUBLIC_STATE', (message) => message.payload.players.length === 3);
    const roundId = state.payload.round.roundId as string;

    host.send('SET_KEYWORD_AND_START', { roundId, keyword: '사과' });
    await host.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_ACTIVE');

    solver.send('SUBMIT_GUESS', { roundId, guessId: crypto.randomUUID(), text: '사과' });
    const scored = await host.next(
      'PUBLIC_STATE',
      (message) => message.payload.players.some((player: any) => player.score > 0)
    );
    const expectedScores = new Map<string, number>(
      scored.payload.players.map((player: any) => [player.playerId, player.score])
    );
    expect([...expectedScores.values()].some((score) => score > 0)).toBe(true);

    // 관전자가 재접속한다. 이전 소켓은 서버가 아직 살아 있다고 믿는 상태다.
    watcher.goSilent();
    const revived = await TestClient.connect(url);
    clients.push(revived);
    const settled = await joinWithRetry(revived, {
      roomCode,
      nickname: '관전자',
      sessionToken: watcherToken
    });
    expect(settled.type, `재입장이 거부됨: ${JSON.stringify(settled.payload)}`).toBe('ROOM_SESSION');

    const revivedState = await revived.next('PUBLIC_STATE');
    const revivedScores = new Map<string, number>(
      revivedState.payload.players.map((player: any) => [player.playerId, player.score])
    );
    expect(revivedScores.get(hostId)).toBe(expectedScores.get(hostId));
    for (const [playerId, score] of expectedScores) {
      expect(revivedScores.get(playerId), `${playerId}의 점수가 0으로 보임`).toBe(score);
    }
  });
});
