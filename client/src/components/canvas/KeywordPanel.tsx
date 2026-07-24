import { useState } from 'react';
import { useGame } from '../../state/GameContext.js';

export const KeywordPanel = () => {
  const { state, send, dispatch } = useGame();
  const [keyword, setKeyword] = useState('');
  const mayStart = state.privateState?.allowedActions.includes('SET_KEYWORD_AND_START') ?? false;
  const privateKeyword = state.privateState?.keyword;
  const roundId = state.publicState?.round.roundId;

  if (privateKeyword !== null && privateKeyword !== undefined) {
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
      className="keyword-panel panel-section"
      onSubmit={(event) => {
        event.preventDefault();
        if (!roundId || !keyword.trim()) return;
        if (send('SET_KEYWORD_AND_START', { roundId, keyword })) setKeyword('');
      }}
    >
      <label htmlFor="keyword">제시어</label>
      <input
        id="keyword"
        value={keyword}
        maxLength={50}
        autoComplete="off"
        onChange={(event) => setKeyword(event.target.value)}
      />
      <button type="submit" className="primary" disabled={!keyword.trim()}>
        제시어 확정 및 시작
      </button>
    </form>
  );
};
