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

  it('응답을 기다리는 동안에는 같은 추측을 두 번 보내지 않는다', () => {
    const { rerender } = render(<GuessInput />);
    submit('사과');
    rerender(<GuessInput />);
    submit('사과');

    expect(game.send).toHaveBeenCalledTimes(1);
  });
});
