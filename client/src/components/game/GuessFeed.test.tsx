// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuessPublic } from '../../../../shared/src/index.js';
import { GuessFeed } from './GuessFeed.js';

const game = vi.hoisted(() => ({
  state: {
    publicState: { guessFeed: [] as GuessPublic[] },
    session: { playerId: 'me' }
  }
}));

vi.mock('../../state/GameContext.js', () => ({
  useGame: () => game
}));

afterEach(cleanup);

const guess = (guessSeq: number): GuessPublic => ({
  guessId: `guess-${guessSeq}`,
  roundId: 'round',
  guessSeq,
  playerId: 'other',
  nickname: '참가자',
  text: `추측 ${guessSeq}`,
  submittedAt: guessSeq,
  isCorrect: false
});

describe('GuessFeed', () => {
  it('정답 추측은 초록색 정답 항목에 짧게 표시한다', () => {
    game.state.publicState.guessFeed = [{
      ...guess(1),
      text: null,
      isCorrect: true
    }];

    render(<GuessFeed />);

    const correctMessage = screen.getByText('정답');
    expect(correctMessage.closest('li')?.classList.contains('correct')).toBe(true);
    expect(screen.queryByText('정답을 맞혔습니다 · 내용 가림')).toBeNull();
  });

  it('새 추측이 들어오면 목록 최하단으로 이동한다', () => {
    game.state.publicState.guessFeed = [guess(1)];
    const { rerender } = render(<GuessFeed />);
    const list = screen.getByRole('list');
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 480 });
    list.scrollTop = 0;

    game.state.publicState.guessFeed = [guess(2)];
    rerender(<GuessFeed />);

    expect(list.scrollTop).toBe(480);
  });
});
