// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuessPublic } from '../../../../shared/src/index.js';
import { GuessInput } from './GuessInput.js';

const game = vi.hoisted(() => ({
  send: vi.fn(),
  state: {
    publicState: { guessFeed: [] as GuessPublic[], round: { roundId: 'round-1' } },
    privateState: { allowedActions: ['SUBMIT_GUESS'], hasAnsweredCorrectly: false },
    failedRequestId: null as string | null
  }
}));

vi.mock('../../state/GameContext.js', () => ({ useGame: () => game }));

beforeEach(() => {
  game.send.mockReset();
  game.send.mockImplementation(() => 'request-1');
  game.state.publicState = { guessFeed: [], round: { roundId: 'round-1' } };
  game.state.failedRequestId = null;
});
afterEach(cleanup);

const submit = (text: string) => {
  fireEvent.change(screen.getByLabelText('정답 추측'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '제출' }));
};

describe('GuessInput', () => {
  it('서버가 제출을 거절하면 다시 제출할 수 있다', () => {
    const { rerender } = render(<GuessInput />);
    submit('사과');
    expect(game.send).toHaveBeenCalledTimes(1);

    game.state.failedRequestId = 'request-1';
    rerender(<GuessInput />);
    submit('바나나');

    expect(game.send).toHaveBeenCalledTimes(2);
  });

  it('라운드가 바뀌면 남아 있던 제출 잠금을 푼다', () => {
    const { rerender } = render(<GuessInput />);
    submit('사과');
    expect(game.send).toHaveBeenCalledTimes(1);

    game.state.publicState = { guessFeed: [], round: { roundId: 'round-2' } };
    rerender(<GuessInput />);
    submit('포도');

    expect(game.send).toHaveBeenCalledTimes(2);
  });

  it('한글을 조합하는 도중 남의 추측이 올라와도 치던 글자가 남아 있다', () => {
    const { rerender } = render(<GuessInput />);
    const input = screen.getByLabelText('정답 추측') as HTMLInputElement;

    // 한글은 자모를 모아 한 글자를 만드는 동안 조합 상태로 머문다.
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '로케' } });

    // 그 사이 다른 참여자(사람이든 AI든)의 추측이 도착해 화면이 다시 그려진다.
    game.state.publicState = {
      guessFeed: [{ guessId: 'other', nickname: '누군가' } as unknown as GuessPublic],
      round: { roundId: 'round-1' }
    };
    rerender(<GuessInput />);

    // 다시 그려졌다고 입력칸을 되돌리면 조합이 끊겨 'ㄹㅗㅋㅔ'처럼 흩어진다.
    expect(input.value).toBe('로케');

    // 조합이 끝나고 이어 친 글자도 그대로 붙는다.
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: '로케트' } });
    expect(input.value).toBe('로케트');
  });

  it('제출하고 나면 입력칸을 비운다', () => {
    const { rerender } = render(<GuessInput />);
    const input = screen.getByLabelText('정답 추측') as HTMLInputElement;
    submit('사과');

    // 서버가 내 추측을 피드에 실어 돌려주면 그때 칸을 비운다.
    game.state.publicState = {
      guessFeed: [{ guessId: game.send.mock.calls[0]![1].guessId } as unknown as GuessPublic],
      round: { roundId: 'round-1' }
    };
    rerender(<GuessInput />);

    expect(input.value).toBe('');
  });

  it('응답을 기다리는 동안에는 같은 추측을 두 번 보내지 않는다', () => {
    const { rerender } = render(<GuessInput />);
    submit('사과');
    rerender(<GuessInput />);
    submit('사과');

    expect(game.send).toHaveBeenCalledTimes(1);
  });
});
