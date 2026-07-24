// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
