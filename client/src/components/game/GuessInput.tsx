import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../state/GameContext.js';

export const GuessInput = () => {
  const { state, send } = useGame();
  /**
   * 입력칸을 React 값으로 묶지 않는다(uncontrolled). 한글은 자모를 모아 한 글자를
   * 만드는 동안 조합 상태로 머무는데, 그 사이에 화면이 다시 그려지면서 React가
   * 입력칸 값을 다시 써 넣으면 조합이 끊겨 '로케트'가 'ㄹㅗㅋㅔㅅ'처럼 흩어진다.
   * 추측 피드는 남이 답할 때마다 갱신되므로 다시 그려질 일이 잦다.
   */
  const inputRef = useRef<HTMLInputElement>(null);
  /** 제출 버튼을 켜고 끄는 데만 쓴다. 참·거짓이라 글자마다 다시 그리지 않는다. */
  const [hasText, setHasText] = useState(false);
  const pending = useRef<{ guessId: string; requestId: string } | null>(null);
  const allowed = state.privateState?.allowedActions.includes('SUBMIT_GUESS') ?? false;
  const hasAnsweredCorrectly = state.privateState?.hasAnsweredCorrectly ?? false;
  const roundId = state.publicState?.round.roundId;
  const failedRequestId = state.failedRequestId;

  const clearInput = (): void => {
    if (inputRef.current) inputRef.current.value = '';
    setHasText(false);
  };

  useEffect(() => {
    const submitted = pending.current;
    if (!submitted) return;
    if (state.publicState?.guessFeed.some((guess) => guess.guessId === submitted.guessId)) {
      pending.current = null;
      clearInput();
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
        const text = inputRef.current?.value ?? '';
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
          ref={inputRef}
          defaultValue=""
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
          onChange={(event) => setHasText(event.target.value.trim().length > 0)}
        />
        <button type="submit" className="primary" disabled={!allowed || !hasText}>
          제출
        </button>
      </div>
    </form>
  );
};
