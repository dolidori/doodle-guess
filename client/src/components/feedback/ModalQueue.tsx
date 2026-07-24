import { useEffect, useRef } from 'react';
import { useGame } from '../../state/GameContext.js';

export const ModalQueue = () => {
  const { state, dispatch } = useGame();
  const modal = state.modalQueue[0];
  const modalKey = modal?.key;
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
        <p>{modal.message}</p>
        <button
          ref={buttonRef}
          type="button"
          className="primary"
          onClick={() => dispatch({ type: 'DISMISS_MODAL' })}
        >
          확인
        </button>
      </section>
    </div>
  );
};
