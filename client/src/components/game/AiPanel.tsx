import { useState } from 'react';
import { ROOM_CAPACITY } from '../../../../shared/src/index.js';
import { useGame } from '../../state/GameContext.js';

/**
 * 대기실에서 AI 참여자를 넣고 빼는 자리. 로비에서 비밀번호를 통과한 사람에게만
 * 보인다. 넣을 수 있는 수는 남은 자리 수와 같다.
 */
export const AiPanel = () => {
  const { state, send } = useGame();
  const [count, setCount] = useState(1);
  const publicState = state.publicState;
  const authorized = state.ai?.authorized ?? false;
  const canAdd = state.privateState?.allowedActions.includes('ADD_AI_PLAYER') ?? false;

  if (!authorized || !publicState || !canAdd) return null;

  const freeSeats = ROOM_CAPACITY - publicState.players.length;
  const aiCount = publicState.players.filter((player) => player.isAI).length;
  const requested = Math.min(count, Math.max(1, freeSeats));

  return (
    <section className="ai-panel panel-section">
      <h3>AI 참여자</h3>
      <p className="ai-panel-summary">
        현재 {aiCount}명 · 빈 자리 {freeSeats}개
      </p>
      {freeSeats > 0 ? (
        <form
          className="ai-panel-form"
          onSubmit={(event) => {
            event.preventDefault();
            send('ADD_AI_PLAYER', { count: requested });
          }}
        >
          <label htmlFor="ai-count">추가할 인원</label>
          <input
            id="ai-count"
            type="number"
            min={1}
            max={freeSeats}
            value={requested}
            onChange={(event) => setCount(Number(event.target.value) || 1)}
          />
          <button type="submit" className="secondary">
            추가
          </button>
        </form>
      ) : (
        <p className="ai-panel-summary">자리가 가득 찼습니다.</p>
      )}
    </section>
  );
};
