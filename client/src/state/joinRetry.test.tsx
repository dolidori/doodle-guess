// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameProvider, useGame } from './GameContext.js';

type Sent = { type: string; requestId: string; payload: any };

/** 테스트가 서버 역할을 하며 응답을 직접 밀어 넣는 WebSocket 대역. */
class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.OPEN;
  readonly sent: Sent[] = [];
  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    if (type === 'open') listener(new Event('open'));
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as Sent);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  /** 서버가 보낸 것처럼 이벤트를 전달한다. */
  deliver(message: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: JSON.stringify(message) });
    }
  }

  get joins(): Sent[] {
    return this.sent.filter((message) => message.type === 'JOIN_ROOM');
  }
}

const Harness = ({ onReady }: { onReady: (join: (code: string, nickname: string) => void) => void }) => {
  const { joinRoom } = useGame();
  onReady(joinRoom);
  return null;
};

describe('입장 실패 자동 재시도', () => {
  let joinRoom: (roomCode: string, nickname: string) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => `id-${Math.random().toString(36).slice(2)}`
    });
    render(
      <GameProvider>
        <Harness onReady={(join) => { joinRoom = join; }} />
      </GameProvider>
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const socket = (): FakeWebSocket => FakeWebSocket.instances[0]!;

  const failLastJoin = (code: string): void => {
    const lastJoin = socket().joins.at(-1)!;
    act(() => {
      socket().deliver({
        v: 1,
        type: 'ERROR',
        requestId: lastJoin.requestId,
        payload: { code, message: '실패', retryable: true }
      });
    });
  };

  it('RATE_LIMITED를 받으면 사용자가 다시 누르지 않아도 재시도한다', () => {
    act(() => joinRoom('123', '참여자'));
    expect(socket().joins).toHaveLength(1);

    failLastJoin('RATE_LIMITED');
    expect(socket().joins, '아직 백오프 대기 중이어야 한다').toHaveLength(1);

    act(() => void vi.advanceTimersByTime(400));
    expect(socket().joins, '자동 재시도가 일어나지 않았다').toHaveLength(2);
    expect(socket().joins[1]!.payload).toMatchObject({ roomCode: '123', nickname: '참여자' });
  });

  it('SESSION_IN_USE도 재시도해 유령 연결이 정리되면 들어간다', () => {
    act(() => joinRoom('123', '참여자'));
    failLastJoin('SESSION_IN_USE');
    act(() => void vi.advanceTimersByTime(400));
    expect(socket().joins).toHaveLength(2);
  });

  it('재시도는 점점 뜸해지고 정해진 횟수에서 멈춘다', () => {
    act(() => joinRoom('123', '참여자'));
    for (const delay of [400, 800, 1600, 3200]) {
      failLastJoin('RATE_LIMITED');
      act(() => void vi.advanceTimersByTime(delay));
    }
    expect(socket().joins, '최대 시도 횟수만큼만 보낸다').toHaveLength(5);

    // 마지막 실패 이후에는 더 시도하지 않는다.
    failLastJoin('RATE_LIMITED');
    act(() => void vi.advanceTimersByTime(10_000));
    expect(socket().joins).toHaveLength(5);
  });

  it('닉네임 중복처럼 사용자가 고쳐야 하는 실패는 재시도하지 않는다', () => {
    act(() => joinRoom('123', '참여자'));
    failLastJoin('NICKNAME_IN_USE');
    act(() => void vi.advanceTimersByTime(10_000));
    expect(socket().joins, '재시도하면 안 된다').toHaveLength(1);
  });

  it('입장에 성공하면 예약된 재시도가 남지 않는다', () => {
    act(() => joinRoom('123', '참여자'));
    failLastJoin('RATE_LIMITED');
    act(() => {
      socket().deliver({
        v: 1,
        type: 'ROOM_SESSION',
        payload: {
          roomCode: '123',
          playerId: 'p1',
          nickname: '참여자',
          mode: 'NORMAL',
          sessionToken: 'token',
          isReconnect: false
        }
      });
    });
    act(() => void vi.advanceTimersByTime(10_000));
    expect(socket().joins, '성공 후에도 재시도가 날아갔다').toHaveLength(1);
  });
});
