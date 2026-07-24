import { useGame } from '../../state/GameContext.js';

export const ServerStatus = () => {
  const { state } = useGame();
  const connected = state.connection.status === 'CONNECTED';
  const label = connected
    ? '서버 연결됨'
    : state.connection.status === 'FAILED'
      ? '서버 연결 끊김'
      : '서버 연결 중';
  return (
    <div className={`server-status ${connected ? 'connected' : ''}`} aria-label={label}>
      <span aria-hidden="true" />
      {label}
    </div>
  );
};
