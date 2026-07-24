import { useEffect, useRef } from 'react';
import { useGame } from '../../state/GameContext.js';

export const ModalQueue = () => {
  const { state, dispatch, send } = useGame();
  const modal = state.modalQueue[0];
  const modalKey = modal?.key;
  const canEndCeremony =
    state.privateState?.allowedActions.includes('END_CEREMONY') ?? false;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!modalKey) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    buttonRef.current?.focus();
    const keepFocusInside = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (
        focusable.length === 1 ||
        (!event.shiftKey && document.activeElement === last) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', keepFocusInside);
    return () => {
      document.removeEventListener('keydown', keepFocusInside);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [modalKey]);
  if (!modal) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className={`modal modal-${modal.kind.toLowerCase()}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <h2 id="modal-title">{modal.title}</h2>
        {modal.answer && <strong className="modal-answer">{modal.answer}</strong>}
        <p>{modal.message}</p>
        {modal.rankings && (
          <ol className="result-rankings" aria-label="최종 순위">
            {modal.rankings.map((ranking) => (
              <li key={ranking.playerId} className={`result-rank-${ranking.rank}`}>
                <strong>{ranking.rank}위 · {ranking.nickname}</strong>
                <span>{ranking.score}점</span>
              </li>
            ))}
          </ol>
        )}
        {modal.kind === 'RESULTS' ? (
          canEndCeremony ? (
            <button
              ref={buttonRef}
              type="button"
              className="primary"
              onClick={() => send('END_CEREMONY', {})}
            >
              시상식 종료 · 대기실로
            </button>
          ) : (
            <p className="ceremony-waiting">방장이 시상식을 마칠 때까지 기다려 주세요.</p>
          )
        ) : (
          <button
            ref={buttonRef}
            type="button"
            className="primary"
            onClick={() => dispatch({ type: 'DISMISS_MODAL' })}
          >
            확인
          </button>
        )}
      </section>
    </div>
  );
};
