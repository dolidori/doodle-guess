import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../../index.js';

type Message = {
  type: string;
  requestId?: string;
  payload: any;
};

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

  async next(type: string, predicate: (message: Message) => boolean = () => true): Promise<Message> {
    const deadline = Date.now() + 3000;
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

  drain(): Message[] {
    return this.messages.splice(0);
  }

  close(): void {
    this.ws.close();
  }

  async closeAndWait(): Promise<void> {
    const closed = new Promise<void>((resolve) => this.ws.once('close', () => resolve()));
    this.ws.close();
    await closed;
  }
}

describe('실제 WebSocket 핵심 게임 흐름', () => {
  let running: RunningServer | undefined;
  const clients: TestClient[] = [];

  afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    await running?.close();
    running = undefined;
  });

  it('방 생성, 참가, PRIVATE 경계, 공개 정답, 단일 해결과 잠금을 보장한다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const url = `ws://127.0.0.1:${running.port}/ws`;
    const host = await TestClient.connect(url);
    const guest = await TestClient.connect(url);
    clients.push(host, guest);

    host.send('CREATE_ROOM', { nickname: '방장', mode: 'NORMAL' });
    const hostSession = await host.next('ROOM_SESSION');
    const initialState = await host.next('PUBLIC_STATE');
    const roomCode = hostSession.payload.roomCode as string;
    const hostToken = hostSession.payload.sessionToken as string;
    expect(roomCode).toMatch(/^[1-9][0-9]{2}$/);
    expect(initialState.payload.players).toHaveLength(1);
    expect(initialState.payload.answerMode).toBe('UNTIL_TIMER');
    await host.next('PRIVATE_STATE');
    await host.next('DRAWING_SNAPSHOT');

    host.send('SET_ANSWER_MODE', { answerMode: 'FIRST_CORRECT' });
    await host.next('PUBLIC_STATE', (message) => message.payload.answerMode === 'FIRST_CORRECT');
    await host.next('PRIVATE_STATE');

    guest.send('JOIN_ROOM', { roomCode, nickname: '참가자' });
    await guest.next('ROOM_SESSION');
    await guest.next('PUBLIC_STATE');
    await guest.next('PRIVATE_STATE');
    await guest.next('DRAWING_SNAPSHOT');
    const hostJoinState = await host.next('PUBLIC_STATE');
    const roundId = hostJoinState.payload.round.roundId as string;
    await host.next('PRIVATE_STATE');

    host.send('SET_KEYWORD_AND_START', { roundId, keyword: '보 라　색' });
    await host.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_ACTIVE');
    const hostPrivate = await host.next('PRIVATE_STATE');
    const guestPublic = await guest.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_ACTIVE');
    const guestPrivate = await guest.next('PRIVATE_STATE');
    expect(hostPrivate.payload.keyword).toBe('보 라　색');
    expect(guestPrivate.payload.keyword).toBeNull();
    expect(JSON.stringify(guestPublic)).not.toContain('보 라');
    expect(JSON.stringify(guestPublic)).not.toContain('보라색');
    expect(JSON.stringify(guestPublic)).not.toContain(hostToken);
    expect(JSON.stringify(guestPrivate)).not.toContain(hostToken);

    const wrongPayload = {
      roundId,
      guessId: crypto.randomUUID(),
      text: '보라'
    };
    const wrongRequestId = guest.send('SUBMIT_GUESS', wrongPayload);
    const wrong = await host.next('GUESS_SHARED');
    await guest.next('GUESS_SHARED');
    expect(wrong.payload.isCorrect).toBe(false);
    expect(wrong.payload.guessSeq).toBe(1);
    guest.send('SUBMIT_GUESS', wrongPayload, wrongRequestId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(host.drain().filter((message) => message.type === 'GUESS_SHARED')).toHaveLength(0);

    guest.send('SUBMIT_GUESS', {
      roundId,
      guessId: crypto.randomUUID(),
      text: '보라색'
    });
    const shared = await host.next('GUESS_SHARED');
    const solved = await host.next('ROUND_SOLVED');
    expect(shared.payload.isCorrect).toBe(true);
    expect(shared.payload.guessSeq).toBe(2);
    expect(solved.payload.winnerNickname).toBe('참가자');
    expect(solved.payload.answerText).toBeNull();
    const solvedState = await host.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_SOLVED');
    expect(solvedState.payload.round.guessLocked).toBe(true);
    expect(solvedState.payload.round.drawingLocked).toBe(true);
    expect(Object.fromEntries(solvedState.payload.players.map(
      (player: any) => [player.nickname, player.score]
    ))).toEqual({ 방장: 1, 참가자: 2 });

    guest.send('SUBMIT_GUESS', {
      roundId,
      guessId: crypto.randomUUID(),
      text: '보라색'
    });
    const error = await guest.next('ERROR');
    expect(error.payload.code).toBe('ROUND_LOCKED');
    expect(host.drain().filter((message) => message.type === 'ROUND_SOLVED')).toHaveLength(0);
  });

  it('서로 다른 방으로 PUBLIC과 추측 이벤트가 유출되지 않는다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const url = `ws://127.0.0.1:${running.port}/ws`;
    const a = await TestClient.connect(url);
    const b = await TestClient.connect(url);
    clients.push(a, b);
    a.send('CREATE_ROOM', { nickname: '가방장', mode: 'NORMAL' });
    b.send('CREATE_ROOM', { nickname: '나방장', mode: 'NORMAL' });
    const aSession = await a.next('ROOM_SESSION');
    const bSession = await b.next('ROOM_SESSION');
    expect(aSession.payload.roomCode).not.toBe(bSession.payload.roomCode);
    await a.next('PUBLIC_STATE');
    await b.next('PUBLIC_STATE');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(a.drain().some((message) =>
      message.type === 'PUBLIC_STATE' && message.payload.roomCode === bSession.payload.roomCode
    )).toBe(false);
    expect(b.drain().some((message) =>
      message.type === 'PUBLIC_STATE' && message.payload.roomCode === aSession.payload.roomCode
    )).toBe(false);
  });

  it('호스트 연결이 끊겨도 권한을 이양하지 않고 같은 슬롯으로 복구한다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const url = `ws://127.0.0.1:${running.port}/ws`;
    const host = await TestClient.connect(url);
    const guest = await TestClient.connect(url);
    clients.push(host, guest);
    host.send('CREATE_ROOM', { nickname: '원래방장', mode: 'NORMAL' });
    const hostSession = await host.next('ROOM_SESSION');
    const initial = await host.next('PUBLIC_STATE');
    const roomCode = hostSession.payload.roomCode as string;
    const hostId = hostSession.payload.playerId as string;
    const firstToken = hostSession.payload.sessionToken as string;
    expect(initial.payload.drawerId).toBe(hostId);
    await host.closeAndWait();

    guest.send('JOIN_ROOM', { roomCode, nickname: '참여자' });
    await guest.next('ROOM_SESSION');
    const disconnectedState = await guest.next(
      'PUBLIC_STATE',
      (message) => message.payload.players.some(
        (player: any) => player.playerId === hostId && player.connected === false
      )
    );
    expect(disconnectedState.payload.drawerId).toBe(hostId);
    expect(disconnectedState.payload.players.filter((player: any) => player.isHost)).toHaveLength(1);

    const recovered = await TestClient.connect(url);
    clients.push(recovered);
    recovered.send('JOIN_ROOM', {
      roomCode,
      nickname: '원래방장',
      sessionToken: firstToken
    });
    const recoveredSession = await recovered.next('ROOM_SESSION');
    expect(recoveredSession.payload.playerId).toBe(hostId);
    expect(recoveredSession.payload.isReconnect).toBe(true);
    expect(recoveredSession.payload.sessionToken).not.toBe(firstToken);
    const recoveredState = await recovered.next('PUBLIC_STATE');
    expect(recoveredState.payload.drawerId).toBe(hostId);
    expect(recoveredState.payload.players.filter((player: any) => player.isHost)).toHaveLength(1);
  });

  it('중복 stroke는 멱등이고 clear 이전 revision을 거부한다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const url = `ws://127.0.0.1:${running.port}/ws`;
    const host = await TestClient.connect(url);
    const guest = await TestClient.connect(url);
    clients.push(host, guest);
    host.send('CREATE_ROOM', { nickname: '화가', mode: 'NORMAL' });
    const hostSession = await host.next('ROOM_SESSION');
    await host.next('PUBLIC_STATE');
    const roomCode = hostSession.payload.roomCode as string;
    await host.next('PRIVATE_STATE');
    await host.next('DRAWING_SNAPSHOT');
    guest.send('JOIN_ROOM', { roomCode, nickname: '관찰자' });
    await guest.next('ROOM_SESSION');
    await guest.next('PUBLIC_STATE');
    await guest.next('PRIVATE_STATE');
    await guest.next('DRAWING_SNAPSHOT');
    const joined = await host.next('PUBLIC_STATE');
    await host.next('PRIVATE_STATE');
    const roundId = joined.payload.round.roundId as string;
    host.send('SET_KEYWORD_AND_START', { roundId, keyword: '선' });
    const active = await host.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_ACTIVE');
    await host.next('PRIVATE_STATE');
    await guest.next('PUBLIC_STATE');
    await guest.next('PRIVATE_STATE');

    const strokeId = crypto.randomUUID();
    const batch = {
      roundId,
      drawingRevision: active.payload.drawing.drawingRevision as number,
      drawerEpoch: active.payload.drawerEpoch as number,
      strokeId,
      batchSeq: 0,
      isFinal: true,
      tool: 'PEN',
      color: 'BLACK',
      width: 'MEDIUM',
      points: [{ x: 0.25, y: 0.5 }]
    };
    host.send('DRAW_STROKE_BATCH', batch);
    const first = await host.next('STROKE_BATCH');
    await guest.next('STROKE_BATCH');
    host.send('DRAW_STROKE_BATCH', batch);
    const duplicate = await host.next('STROKE_BATCH');
    expect(duplicate.payload.drawingSeq).toBe(first.payload.drawingSeq);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(guest.drain().filter((message) => message.type === 'STROKE_BATCH')).toHaveLength(0);

    host.send('CLEAR_DRAWING', {
      roundId,
      drawingRevision: batch.drawingRevision,
      drawerEpoch: batch.drawerEpoch
    });
    const cleared = await host.next('DRAWING_CLEARED');
    expect(cleared.payload.drawingRevision).toBe(batch.drawingRevision + 1);
    host.send('DRAW_STROKE_BATCH', {
      ...batch,
      strokeId: crypto.randomUUID(),
      batchSeq: 0
    });
    const error = await host.next('ERROR');
    expect(error.payload.code).toBe('STALE_DRAWING_REVISION');
  });

  it('진행자가 drawer를 지정·회수하고 이전 drawer의 추측을 차단한다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const url = `ws://127.0.0.1:${running.port}/ws`;
    const moderator = await TestClient.connect(url);
    const drawer = await TestClient.connect(url);
    const guesser = await TestClient.connect(url);
    clients.push(moderator, drawer, guesser);

    moderator.send('CREATE_ROOM', { nickname: '진행자', mode: 'MODERATOR' });
    const moderatorSession = await moderator.next('ROOM_SESSION');
    const roomCode = moderatorSession.payload.roomCode as string;
    await moderator.next('PUBLIC_STATE');
    await moderator.next('PRIVATE_STATE');
    await moderator.next('DRAWING_SNAPSHOT');

    drawer.send('JOIN_ROOM', { roomCode, nickname: '그림담당' });
    const drawerSession = await drawer.next('ROOM_SESSION');
    await drawer.next('PUBLIC_STATE');
    await drawer.next('PRIVATE_STATE');
    await drawer.next('DRAWING_SNAPSHOT');
    await moderator.next('PUBLIC_STATE');
    await moderator.next('PRIVATE_STATE');

    guesser.send('JOIN_ROOM', { roomCode, nickname: '추측자' });
    await guesser.next('ROOM_SESSION');
    await guesser.next('PUBLIC_STATE');
    await guesser.next('PRIVATE_STATE');
    await guesser.next('DRAWING_SNAPSHOT');
    const ready = await moderator.next('PUBLIC_STATE');
    await moderator.next('PRIVATE_STATE');
    await drawer.next('PUBLIC_STATE');
    await drawer.next('PRIVATE_STATE');

    moderator.send('ASSIGN_DRAWER', { targetPlayerId: drawerSession.payload.playerId });
    const assigned = await drawer.next('PUBLIC_STATE', (message) =>
      message.payload.drawerId === drawerSession.payload.playerId
    );
    const assignedPrivate = await drawer.next('PRIVATE_STATE');
    expect(assignedPrivate.payload.allowedActions).toContain('SET_KEYWORD_AND_START');
    await moderator.next('PUBLIC_STATE');
    await moderator.next('PRIVATE_STATE');
    await guesser.next('PUBLIC_STATE');
    await guesser.next('PRIVATE_STATE');

    drawer.send('SET_KEYWORD_AND_START', {
      roundId: assigned.payload.round.roundId,
      keyword: '연필'
    });
    await drawer.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_ACTIVE');
    expect((await drawer.next('PRIVATE_STATE')).payload.keyword).toBe('연필');
    await moderator.next('PUBLIC_STATE');
    expect((await moderator.next('PRIVATE_STATE')).payload.keyword).toBe('연필');
    await guesser.next('PUBLIC_STATE');
    expect((await guesser.next('PRIVATE_STATE')).payload.keyword).toBeNull();

    moderator.send('RECLAIM_DRAWER', {});
    const reclaimed = await drawer.next('PUBLIC_STATE', (message) =>
      message.payload.drawerId === moderatorSession.payload.playerId
    );
    const formerPrivate = await drawer.next('PRIVATE_STATE');
    expect(formerPrivate.payload.keyword).toBeNull();
    expect(formerPrivate.payload.hasSeenKeywordThisRound).toBe(true);
    expect(formerPrivate.payload.allowedActions).not.toContain('SUBMIT_GUESS');

    drawer.send('SUBMIT_GUESS', {
      roundId: reclaimed.payload.round.roundId,
      guessId: crypto.randomUUID(),
      text: '연필'
    });
    const error = await drawer.next('ERROR');
    expect(error.payload.code).toBe('GUESS_FORBIDDEN');
    expect(ready.payload.mode).toBe('MODERATOR');
  });

  it('서버 만료 확정 뒤 그림과 추측을 모두 잠근다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const url = `ws://127.0.0.1:${running.port}/ws`;
    const host = await TestClient.connect(url);
    const guest = await TestClient.connect(url);
    clients.push(host, guest);

    host.send('CREATE_ROOM', { nickname: '시간관리자', mode: 'NORMAL' });
    const hostSession = await host.next('ROOM_SESSION');
    const roomCode = hostSession.payload.roomCode as string;
    await host.next('PUBLIC_STATE');
    await host.next('PRIVATE_STATE');
    await host.next('DRAWING_SNAPSHOT');

    guest.send('JOIN_ROOM', { roomCode, nickname: '늦은참가자' });
    await guest.next('ROOM_SESSION');
    await guest.next('PUBLIC_STATE');
    await guest.next('PRIVATE_STATE');
    await guest.next('DRAWING_SNAPSHOT');
    const ready = await host.next('PUBLIC_STATE');
    await host.next('PRIVATE_STATE');

    const roundId = ready.payload.round.roundId as string;
    host.send('SET_KEYWORD_AND_START', { roundId, keyword: '시계' });
    const active = await host.next(
      'PUBLIC_STATE',
      (message) => message.payload.status === 'ROUND_ACTIVE'
    );
    await host.next('PRIVATE_STATE');
    await guest.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_ACTIVE');
    await guest.next('PRIVATE_STATE');

    const room = running.registry.get(roomCode);
    const expired = await room.queue.enqueue(() =>
      running!.dispatcher.gameService.expireRound(
        room,
        roundId,
        room.round.roundEndsAt!
      )
    );
    expect(expired).toBe(true);
    const expiredEvent = await guest.next('ROUND_EXPIRED');
    expect(expiredEvent.payload.roundId).toBe(roundId);
    expect(expiredEvent.payload.answerText).toBe('시계');
    const expiredState = await guest.next(
      'PUBLIC_STATE',
      (message) => message.payload.status === 'ROUND_EXPIRED'
    );
    expect(expiredState.payload.round.guessLocked).toBe(true);
    expect(expiredState.payload.round.drawingLocked).toBe(true);

    guest.send('SUBMIT_GUESS', {
      roundId,
      guessId: crypto.randomUUID(),
      text: '시계'
    });
    expect((await guest.next('ERROR')).payload.code).toBe('ROUND_LOCKED');

    host.send('DRAW_STROKE_BATCH', {
      roundId,
      drawingRevision: active.payload.drawing.drawingRevision,
      drawerEpoch: active.payload.drawerEpoch,
      strokeId: crypto.randomUUID(),
      batchSeq: 0,
      isFinal: true,
      tool: 'PEN',
      color: 'BLACK',
      width: 'MEDIUM',
      points: [{ x: 0.5, y: 0.5 }]
    });
    expect((await host.next('ERROR')).payload.code).toBe('ROUND_LOCKED');
  });

  it('타이머 모드에서 정답을 가리고 점수를 누적한 뒤 대기실과 다른 모드에서도 유지한다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const url = `ws://127.0.0.1:${running.port}/ws`;
    const host = await TestClient.connect(url);
    const drawer = await TestClient.connect(url);
    const guesser = await TestClient.connect(url);
    clients.push(host, drawer, guesser);

    host.send('CREATE_ROOM', { nickname: '방장', mode: 'NORMAL' });
    const hostSession = await host.next('ROOM_SESSION');
    const roomCode = hostSession.payload.roomCode as string;
    await host.next('PUBLIC_STATE');
    await host.next('PRIVATE_STATE');
    await host.next('DRAWING_SNAPSHOT');

    drawer.send('JOIN_ROOM', { roomCode, nickname: '화가' });
    const drawerSession = await drawer.next('ROOM_SESSION');
    await drawer.next('PUBLIC_STATE');
    await drawer.next('PRIVATE_STATE');
    await drawer.next('DRAWING_SNAPSHOT');
    await host.next('PUBLIC_STATE');
    await host.next('PRIVATE_STATE');

    guesser.send('JOIN_ROOM', { roomCode, nickname: '추측자' });
    const guesserSession = await guesser.next('ROOM_SESSION');
    await guesser.next('PUBLIC_STATE');
    await guesser.next('PRIVATE_STATE');
    await guesser.next('DRAWING_SNAPSHOT');
    const ready = await host.next('PUBLIC_STATE');
    await host.next('PRIVATE_STATE');
    await drawer.next('PUBLIC_STATE');
    await drawer.next('PRIVATE_STATE');

    host.send('SET_ANSWER_MODE', { answerMode: 'UNTIL_TIMER' });
    expect((await host.next('PUBLIC_STATE', (message) =>
      message.payload.answerMode === 'UNTIL_TIMER'
    )).payload.answerMode).toBe('UNTIL_TIMER');
    await host.next('PRIVATE_STATE');
    await drawer.next('PUBLIC_STATE', (message) => message.payload.answerMode === 'UNTIL_TIMER');
    await drawer.next('PRIVATE_STATE');
    await guesser.next('PUBLIC_STATE', (message) => message.payload.answerMode === 'UNTIL_TIMER');
    await guesser.next('PRIVATE_STATE');

    host.send('ASSIGN_DRAWER', { targetPlayerId: drawerSession.payload.playerId });
    const assigned = await drawer.next('PUBLIC_STATE', (message) =>
      message.payload.drawerId === drawerSession.payload.playerId
    );
    expect((await drawer.next('PRIVATE_STATE')).payload.allowedActions)
      .toContain('SET_KEYWORD_AND_START');
    await host.next('PUBLIC_STATE', (message) =>
      message.payload.drawerId === drawerSession.payload.playerId
    );
    await host.next('PRIVATE_STATE');
    await guesser.next('PUBLIC_STATE', (message) =>
      message.payload.drawerId === drawerSession.payload.playerId
    );
    await guesser.next('PRIVATE_STATE');

    const roundId = assigned.payload.round.roundId as string;
    drawer.send('SET_KEYWORD_AND_START', { roundId, keyword: '해바라기' });
    await drawer.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_ACTIVE');
    expect((await drawer.next('PRIVATE_STATE')).payload.keyword).toBe('해바라기');
    await host.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_ACTIVE');
    await host.next('PRIVATE_STATE');
    await guesser.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_ACTIVE');
    expect((await guesser.next('PRIVATE_STATE')).payload.keyword).toBeNull();

    host.send('SUBMIT_GUESS', {
      roundId,
      guessId: crypto.randomUUID(),
      text: '해 바 라 기'
    });
    const hostCorrect = await host.next('GUESS_SHARED');
    const drawerSawCorrect = await drawer.next('GUESS_SHARED');
    const guesserSawCorrect = await guesser.next('GUESS_SHARED');
    expect(hostCorrect.payload).toMatchObject({ isCorrect: true, text: null });
    expect(drawerSawCorrect.payload.text).toBeNull();
    expect(guesserSawCorrect.payload.text).toBeNull();
    expect(JSON.stringify(guesserSawCorrect)).not.toContain('해바라기');

    const firstScoreState = await host.next('PUBLIC_STATE', (message) =>
      message.payload.round.correctCount === 1
    );
    expect(firstScoreState.payload.status).toBe('ROUND_ACTIVE');
    expect(firstScoreState.payload.players.find(
      (player: any) => player.playerId === hostSession.payload.playerId
    ).score).toBe(3);
    expect(firstScoreState.payload.players.find(
      (player: any) => player.playerId === drawerSession.payload.playerId
    ).score).toBe(1);
    const hostPrivate = await host.next('PRIVATE_STATE');
    expect(hostPrivate.payload.hasAnsweredCorrectly).toBe(true);
    expect(hostPrivate.payload.allowedActions).not.toContain('SUBMIT_GUESS');
    await drawer.next('PUBLIC_STATE', (message) => message.payload.round.correctCount === 1);
    await drawer.next('PRIVATE_STATE');
    await guesser.next('PUBLIC_STATE', (message) => message.payload.round.correctCount === 1);
    await guesser.next('PRIVATE_STATE');

    host.send('SUBMIT_GUESS', {
      roundId,
      guessId: crypto.randomUUID(),
      text: '해바라기'
    });
    expect((await host.next('ERROR')).payload.code).toBe('GUESS_FORBIDDEN');

    guesser.send('SUBMIT_GUESS', {
      roundId,
      guessId: crypto.randomUUID(),
      text: '해바라기'
    });
    await host.next('GUESS_SHARED', (message) => message.payload.playerId === guesserSession.payload.playerId);
    await drawer.next('GUESS_SHARED', (message) => message.payload.playerId === guesserSession.payload.playerId);
    await guesser.next('GUESS_SHARED', (message) => message.payload.playerId === guesserSession.payload.playerId);
    const expired = await host.next('ROUND_EXPIRED');
    await drawer.next('ROUND_EXPIRED');
    await guesser.next('ROUND_EXPIRED');
    const secondScoreState = await host.next('PUBLIC_STATE', (message) =>
      message.payload.round.correctCount === 2
    );
    const scores = Object.fromEntries(secondScoreState.payload.players.map(
      (player: any) => [player.nickname, player.score]
    ));
    expect(scores).toEqual({ 방장: 3, 화가: 2, 추측자: 2 });
    expect(secondScoreState.payload.status).toBe('ROUND_EXPIRED');
    expect(expired.payload).toMatchObject({
      answerMode: 'UNTIL_TIMER',
      correctCount: 2,
      answerText: null
    });
    await host.next('PRIVATE_STATE');
    await drawer.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_EXPIRED');
    await drawer.next('PRIVATE_STATE');
    await guesser.next('PUBLIC_STATE', (message) => message.payload.status === 'ROUND_EXPIRED');
    await guesser.next('PRIVATE_STATE');

    host.send('SET_ANSWER_MODE', { answerMode: 'FIRST_CORRECT' });
    expect((await host.next('ERROR')).payload.code).toBe('INVALID_PHASE');

    host.send('RETURN_TO_WAITING', { roundId });
    const waiting = await host.next('PUBLIC_STATE', (message) => message.payload.status === 'WAITING');
    expect(waiting.payload.round.correctCount).toBe(0);
    expect(Object.fromEntries(waiting.payload.players.map(
      (player: any) => [player.nickname, player.score]
    ))).toEqual(scores);
    await host.next('PRIVATE_STATE');

    host.send('SET_ANSWER_MODE', { answerMode: 'FIRST_CORRECT' });
    const changed = await host.next('PUBLIC_STATE', (message) =>
      message.payload.status === 'WAITING' && message.payload.answerMode === 'FIRST_CORRECT'
    );
    expect(Object.fromEntries(changed.payload.players.map(
      (player: any) => [player.nickname, player.score]
    ))).toEqual(scores);
    expect(ready.payload.answerMode).toBe('UNTIL_TIMER');
  });

  it('서버 재시작 후 이전 메모리 방은 ROOM_NOT_FOUND를 반환한다', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const firstUrl = `ws://127.0.0.1:${running.port}/ws`;
    const host = await TestClient.connect(firstUrl);
    clients.push(host);
    host.send('CREATE_ROOM', { nickname: '재시작호스트', mode: 'NORMAL' });
    const session = await host.next('ROOM_SESSION');
    await host.closeAndWait();
    await running.close();
    running = undefined;

    running = await startServer({ port: 0, host: '127.0.0.1', nodeEnv: 'test' });
    const recovered = await TestClient.connect(`ws://127.0.0.1:${running.port}/ws`);
    clients.push(recovered);
    recovered.send('JOIN_ROOM', {
      roomCode: session.payload.roomCode,
      nickname: session.payload.nickname,
      sessionToken: session.payload.sessionToken
    });
    const error = await recovered.next('ERROR');
    expect(error.payload.code).toBe('ROOM_NOT_FOUND');
  });
});
