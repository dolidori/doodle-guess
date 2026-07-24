import { useGame } from '../../state/GameContext.js';

export const GuessFeed = () => {
  const { state } = useGame();
  const feed = state.publicState?.guessFeed ?? [];
  return (
    <section className="guess-feed panel-section" aria-labelledby="guess-feed-title">
      <h3 id="guess-feed-title">공개 추측</h3>
      <ol aria-live="polite">
        {feed.length === 0 && <li className="empty">아직 추측이 없습니다.</li>}
        {feed.map((guess) => (
          <li key={`${guess.roundId}:${guess.guessSeq}`} className={guess.isCorrect ? 'correct' : ''}>
            <span className="guess-seq">#{guess.guessSeq}</span>
            <strong>{guess.nickname}</strong>
            <span>{guess.text ?? '정답을 맞혔습니다 · 내용 가림'}</span>
            {guess.isCorrect && <b className="answer-badge">정답</b>}
          </li>
        ))}
      </ol>
    </section>
  );
};
