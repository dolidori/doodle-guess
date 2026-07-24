import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../state/GameContext.js';

export const KeywordPanel = () => {
  const { state, send, dispatch } = useGame();
  const keywordInputRef = useRef<HTMLInputElement>(null);
  const [shufflePending, setShufflePending] = useState(false);
  const mayStart = state.privateState?.allowedActions.includes('SET_KEYWORD_AND_START') ?? false;
  const privateKeyword = state.privateState?.keyword;
  const suggestedKeyword = state.privateState?.suggestedKeyword;
  const roundId = state.publicState?.round.roundId;
  const continuing = state.publicState?.round.status === 'SOLVED' ||
    state.publicState?.round.status === 'EXPIRED';
  useEffect(() => {
    if (!shufflePending) return;
    const timeout = window.setTimeout(() => setShufflePending(false), 350);
    return () => window.clearTimeout(timeout);
  }, [shufflePending]);

  if (privateKeyword !== null && privateKeyword !== undefined && !continuing) {
    return (
      <section className="keyword-panel panel-section">
        <h3>제시어</h3>
        {state.keywordHidden ? (
          <p className="keyword-hidden">제시어가 가려졌습니다.</p>
        ) : (
          <p className="keyword-value">{privateKeyword}</p>
        )}
        <button type="button" className="secondary" onClick={() => dispatch({ type: 'TOGGLE_KEYWORD' })}>
          {state.keywordHidden ? '제시어 보기' : '제시어 가리기'}
        </button>
      </section>
    );
  }

  if (!mayStart) {
    return (
      <section className="keyword-panel panel-section">
        <h3>제시어 준비</h3>
        <p>그리기 사용자가 제시어를 준비하고 있습니다.</p>
      </section>
    );
  }

  return (
    <form
      className="keyword-panel keyword-entry-panel panel-section"
      onSubmit={(event) => {
        event.preventDefault();
        const keyword = keywordInputRef.current?.value ?? '';
        if (!roundId || !keyword.trim()) return;
        if (send('SET_KEYWORD_AND_START', { roundId, keyword }) && keywordInputRef.current) {
          keywordInputRef.current.value = '';
        }
      }}
    >
      <label htmlFor="keyword">{continuing ? '다음 라운드 제시어' : '제시어'}</label>
      <input
        key={suggestedKeyword}
        ref={keywordInputRef}
        id="keyword"
        defaultValue={suggestedKeyword ?? ''}
        maxLength={50}
        autoComplete="off"
      />
      {state.privateState?.allowedActions.includes('SHUFFLE_KEYWORD') && (
        <button
          type="button"
          className="secondary"
          aria-label="기본 제시어 다시 뽑기"
          disabled={shufflePending}
          onClick={() => {
            if (send('SHUFFLE_KEYWORD', {})) setShufflePending(true);
          }}
        >
          다시 뽑기
        </button>
      )}
      <button
        type="submit"
        className="primary"
        aria-label={continuing ? '다음 라운드 바로 시작' : '제시어 확정 및 시작'}
      >
        {continuing ? '다음 라운드 시작' : '확정 및 시작'}
      </button>
    </form>
  );
};
