import { useGame } from '../../state/GameContext.js';

export const ToastQueue = () => {
  const { state } = useGame();
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {state.toastQueue.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>{toast.message}</div>
      ))}
    </div>
  );
};
