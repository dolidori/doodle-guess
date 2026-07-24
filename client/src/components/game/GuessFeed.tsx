import { useLayoutEffect, useRef } from 'react';
import { useGame } from '../../state/GameContext.js';

export const GuessFeed = () => {
  const { state } = useGame();
  const feed = state.publicState?.guessFeed ?? [];
  const playerId = state.session?.playerId;
  const listRef = useRef<HTMLOListElement>(null);
  const latestGuessKey = feed.length
    ? `${feed.at(-1)!.roundId}:${feed.at(-1)!.guessSeq}`
    : null;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [latestGuessKey]);

  return (
    <section className="guess-feed panel-section" aria-labelledby="guess-feed-title">
      <h3 id="guess-feed-title">공개 추측</h3>
      <ol ref={listRef} aria-live="polite">
        {feed.length === 0 && <li className="empty">아직 추측이 없습니다.</li>}
        {feed.map((guess) => (
          <li
            key={`${guess.roundId}:${guess.guessSeq}`}
            className={[
              guess.playerId === playerId ? 'mine' : '',
              guess.isCorrect ? 'correct' : ''
            ].filter(Boolean).join(' ')}
          >
            <div className="guess-message-meta">
              <strong>{guess.nickname}</strong>
              <span className="guess-seq">#{guess.guessSeq}</span>
            </div>
            <span className="guess-message-text">
              {guess.text ?? '정답을 맞혔습니다 · 내용 가림'}
            </span>
            {guess.isCorrect && <b className="answer-badge">정답</b>}
          </li>
        ))}
      </ol>
    </section>
  );
};
