import { useEffect, useState } from 'react';
import { MAX_KEYWORD_SHUFFLES } from '../../../../shared/src/index.js';
import { useGame } from '../../state/GameContext.js';

export const KeywordPanel = () => {
  const { state, send, dispatch } = useGame();
  // 직접 쓴 제시어. 다시 뽑기로 추천 제시어가 바뀌면 자동으로 무효가 된다.
  const [draft, setDraft] = useState<{ base: string | null; text: string } | null>(null);
  const [shufflePending, setShufflePending] = useState(false);
  const mayStart = state.privateState?.allowedActions.includes('SET_KEYWORD_AND_START') ?? false;
  const mayLock = state.privateState?.allowedActions.includes('LOCK_KEYWORD') ?? false;
  const mayUnlock = state.privateState?.allowedActions.includes('UNLOCK_KEYWORD') ?? false;
  const privateKeyword = state.privateState?.keyword;
  const suggestedKeyword = state.privateState?.suggestedKeyword;
  const lockedKeyword = state.privateState?.lockedKeyword ?? null;
  const keywordLocked = state.publicState?.keywordLocked ?? false;
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

  // 잠긴 제시어는 그리기 담당자도 바꿀 수 없다. 진행자만 잠금을 풀 수 있다.
  if (keywordLocked) {
    return (
      <section className="keyword-panel keyword-locked-panel panel-section">
        <h3>
          {continuing ? '다음 라운드 제시어' : '제시어'}
          <span aria-hidden="true"> 🔒</span>
        </h3>
        {lockedKeyword && !state.keywordHidden ? (
          <p className="keyword-value">{lockedKeyword}</p>
        ) : (
          <p className="keyword-hidden">진행자가 제시어를 잠갔습니다.</p>
        )}
        <div className="locked-actions">
          {lockedKeyword && (
            <button
              type="button"
              className="secondary"
              onClick={() => dispatch({ type: 'TOGGLE_KEYWORD' })}
            >
              {state.keywordHidden ? '제시어 보기' : '제시어 가리기'}
            </button>
          )}
          {mayUnlock && (
            <button type="button" className="secondary" onClick={() => send('UNLOCK_KEYWORD', {})}>
              잠금 해제
            </button>
          )}
          {mayStart && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (!roundId || !lockedKeyword) return;
                send('SET_KEYWORD_AND_START', { roundId, keyword: lockedKeyword });
              }}
            >
              {continuing ? '다음 라운드 시작' : '시작'}
            </button>
          )}
        </div>
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

  const keyword = draft && draft.base === suggestedKeyword ? draft.text : suggestedKeyword ?? '';

  return (
    <form
      className={`keyword-panel keyword-entry-panel panel-section ${mayLock ? 'lockable' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!roundId || !keyword.trim()) return;
        send('SET_KEYWORD_AND_START', { roundId, keyword });
      }}
    >
      <label htmlFor="keyword">{continuing ? '다음 라운드 제시어' : '제시어'}</label>
      {/* 방장이 기본 담당자라 제시어가 그냥 보이면 추측에 낄 수 없다. 기본은 가림. */}
      <div className="keyword-input-row">
        {state.keywordHidden ? (
          <p className="keyword-masked" aria-label="제시어가 가려져 있습니다">••••••</p>
        ) : (
          <input
            id="keyword"
            value={keyword}
            onChange={(event) => setDraft({
              base: suggestedKeyword ?? null,
              text: event.target.value
            })}
            maxLength={50}
            autoComplete="off"
          />
        )}
        <button
          type="button"
          className="secondary reveal-button"
          title={
            state.keywordHidden
              ? '제시어를 보고 나서 그리기 권한을 넘기면, 제시어가 새로 뽑히고 다시 뽑기 횟수를 한 번 씁니다.'
              : undefined
          }
          onClick={() => {
            // 서버가 열람 사실을 알아야 인계할 때 재추첨 여부를 판단할 수 있다.
            if (state.keywordHidden) send('REVEAL_KEYWORD', {});
            dispatch({ type: 'TOGGLE_KEYWORD' });
          }}
        >
          {state.keywordHidden ? '보기' : '가리기'}
        </button>
      </div>
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
      {mayLock && (
        <button
          type="button"
          className="secondary lock-button"
          aria-label="제시어 잠그기, 그리기 권한을 받은 참여자가 바꿀 수 없게 합니다"
          onClick={() => {
            if (!keyword.trim()) return;
            send('LOCK_KEYWORD', { keyword });
          }}
        >
          잠금
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
