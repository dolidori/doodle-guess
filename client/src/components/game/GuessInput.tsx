import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../state/GameContext.js';

export const GuessInput = () => {
  const { state, send } = useGame();
  const [text, setText] = useState('');
  const pending = useRef<{ guessId: string; requestId: string } | null>(null);
  const allowed = state.privateState?.allowedActions.includes('SUBMIT_GUESS') ?? false;
  const hasAnsweredCorrectly = state.privateState?.hasAnsweredCorrectly ?? false;
  const roundId = state.publicState?.round.roundId;
  const failedRequestId = state.failedRequestId;

  useEffect(() => {
    const submitted = pending.current;
    if (!submitted) return;
    if (state.publicState?.guessFeed.some((guess) => guess.guessId === submitted.guessId)) {
      pending.current = null;
      setText('');
    }
  }, [state.publicState?.guessFeed]);

  // 서버가 거절한 제출은 추측 피드에 실리지 않는다. 실패한 요청까지 붙잡고 있으면
  // 다음 제출이 조용히 막히므로, 거절 응답과 라운드 교체 때 잠금을 풀어 준다.
  useEffect(() => {
    if (failedRequestId && failedRequestId === pending.current?.requestId) pending.current = null;
  }, [failedRequestId]);

  useEffect(() => {
    pending.current = null;
  }, [roundId]);

  return (
    <form
      className="guess-input"
      onSubmit={(event) => {
        event.preventDefault();
        if (!allowed || !roundId || !text.trim() || pending.current) return;
        const guessId = crypto.randomUUID();
        const requestId = send('SUBMIT_GUESS', { roundId, guessId, text });
        if (requestId) pending.current = { guessId, requestId };
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
