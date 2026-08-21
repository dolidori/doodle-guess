import { useEffect, useRef, useState } from 'react';
import { MAX_KEYWORD_SHUFFLES } from '../../../../shared/src/index.js';
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
  // 서버가 허용을 거둬가면(라운드 단계가 아니거나 소진) 0으로 본다.
  const remainingShuffles = state.privateState?.allowedActions.includes('SHUFFLE_KEYWORD')
    ? state.privateState.remainingKeywordShuffles
    : 0;
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
      <button
        type="button"
        className="secondary shuffle-button"
        aria-label={
          remainingShuffles > 0
            ? `기본 제시어 다시 뽑기, ${MAX_KEYWORD_SHUFFLES}번 중 ${remainingShuffles}번 남음`
            : `다시 뽑기를 ${MAX_KEYWORD_SHUFFLES}번 모두 썼습니다. 제시어를 직접 입력해 주세요.`
        }
        title={
          remainingShuffles > 0
            ? undefined
            : `다시 뽑기는 라운드마다 ${MAX_KEYWORD_SHUFFLES}번까지입니다.`
        }
        disabled={shufflePending || remainingShuffles === 0}
        onClick={() => {
          if (send('SHUFFLE_KEYWORD', {})) setShufflePending(true);
        }}
      >
        다시 뽑기
        <span className="shuffle-count" aria-hidden="true">
          {remainingShuffles}／{MAX_KEYWORD_SHUFFLES}
        </span>
      </button>
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
