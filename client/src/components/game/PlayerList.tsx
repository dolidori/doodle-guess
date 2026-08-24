import { useGame } from '../../state/GameContext.js';

export const PlayerList = () => {
  const { state, send } = useGame();
  const publicState = state.publicState;
  const me = state.session?.playerId;
  if (!publicState) return null;
  const canKick = state.privateState?.allowedActions.includes('KICK_PLAYER') ?? false;
  const canAssign = state.privateState?.allowedActions.includes('ASSIGN_DRAWER') ?? false;
  return (
    <aside className="player-panel" aria-labelledby="players-title">
      <h2 id="players-title">참가자 {publicState.players.length}/30</h2>
      <ul>
        {publicState.players.map((player) => (
          <li key={player.playerId} className={player.playerId === publicState.drawerId ? 'drawer' : ''}>
            <div>
              <strong>{player.nickname}{player.playerId === me ? ' (나)' : ''}</strong>
              <span>{player.score}점 · {player.connected ? '연결됨' : '연결 끊김'}</span>
            </div>
            <div className="badges">
              {player.isHost && <span>호스트</span>}
              {player.isModerator && <span>진행자</span>}
              {player.playerId === publicState.drawerId && <span>그리기</span>}
            </div>
            {player.playerId !== me && !player.isModerator && (
              <div className="player-actions">
                {canAssign && player.connected && player.playerId !== publicState.drawerId && (
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={() => send('ASSIGN_DRAWER', { targetPlayerId: player.playerId })}
                  >
                    그리기 권한 주기
                  </button>
                )}
                {canKick && (
                  <button
                    type="button"
                    className="danger compact"
                    onClick={() => send('KICK_PLAYER', { targetPlayerId: player.playerId })}
                  >
                    내보내기
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
};
