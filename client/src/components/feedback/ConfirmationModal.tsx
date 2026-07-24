import { useEffect, useId, useRef } from 'react';

type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmationModal = ({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel
}: Props) => {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)'
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (
        (!event.shiftKey && document.activeElement === last) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [onCancel]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="modal confirmation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={messageId}>{message}</p>
        <div className="modal-actions">
          <button ref={cancelButtonRef} type="button" className="secondary" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
};
