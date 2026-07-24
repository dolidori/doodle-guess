import { useEffect, useRef } from 'react';
import { useGame } from '../../state/GameContext.js';

export const ReconnectOverlay = () => {
  const { state, resetToLobby } = useGame();
  const actionRef = useRef<HTMLButtonElement>(null);
  const shouldFocusAction = state.screen === 'KICKED' ||
    state.screen === 'CLOSED' ||
    (state.screen === 'ROOM' && state.connection.status === 'FAILED');
  useEffect(() => {
    if (shouldFocusAction) actionRef.current?.focus();
  }, [shouldFocusAction]);
  if (state.screen === 'KICKED' || state.screen === 'CLOSED') {
    return (
      <div
        className="blocking-overlay"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="blocking-overlay-title"
      >
        <section>
          <h1 id="blocking-overlay-title">
            {state.screen === 'KICKED' ? '방에서 내보내졌습니다' : '방이 종료되었습니다'}
          </h1>
          <p>{state.blockingMessage}</p>
          <button
            ref={actionRef}
            type="button"
            className="primary"
            onClick={resetToLobby}
          >
            로비로 돌아가기
          </button>
        </section>
      </div>
    );
  }
  if (state.screen === 'ROOM' &&
      (state.connection.status === 'RECONNECTING' || state.connection.status === 'FAILED')) {
    return (
      <div className="blocking-overlay" role="alert" aria-live="assertive">
        <section>
          <h1>{state.connection.status === 'FAILED' ? '연결 실패' : '재연결 중'}</h1>
          <p>
            {state.connection.status === 'RECONNECTING'
              ? `서버 연결을 다시 시도하고 있습니다. ${state.connection.attempts}회`
              : '서버에 연결할 수 없습니다.'}
          </p>
          {state.connection.status === 'FAILED' && (
            <button
              ref={actionRef}
              type="button"
              className="secondary"
              onClick={resetToLobby}
            >
              로비로 나가기
            </button>
          )}
        </section>
      </div>
    );
  }
  return null;
};
