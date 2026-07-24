import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../state/GameContext.js';

export const GuessInput = () => {
  const { state, send } = useGame();
  const [text, setText] = useState('');
  const pendingGuessId = useRef<string | null>(null);
  const allowed = state.privateState?.allowedActions.includes('SUBMIT_GUESS') ?? false;
  const hasAnsweredCorrectly = state.privateState?.hasAnsweredCorrectly ?? false;
  const roundId = state.publicState?.round.roundId;

  useEffect(() => {
    if (!pendingGuessId.current) return;
    if (state.publicState?.guessFeed.some((guess) => guess.guessId === pendingGuessId.current)) {
      pendingGuessId.current = null;
      setText('');
    }
  }, [state.publicState?.guessFeed]);

  return (
    <form
      className="guess-input"
      onSubmit={(event) => {
        event.preventDefault();
        if (!allowed || !roundId || !text.trim() || pendingGuessId.current) return;
        const guessId = crypto.randomUUID();
        if (send('SUBMIT_GUESS', { roundId, guessId, text })) pendingGuessId.current = guessId;
      }}
    >
      <label htmlFor="guess">정답 추측</label>
      <div>
        <input
          id="guess"
          value={text}
          maxLength={80}
          autoComplete="off"
          disabled={!allowed}
          placeholder={
            allowed
              ? '무엇을 그리고 있을까요?'
              : hasAnsweredCorrectly
                ? '정답을 맞혔습니다'
                : '현재는 추측할 수 없습니다'
          }
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="primary" disabled={!allowed || !text.trim()}>
          제출
        </button>
      </div>
    </form>
  );
};
