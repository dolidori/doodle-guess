import { useGame } from '../../state/GameContext.js';

const formatTime = (seconds: number | null): string => {
  if (seconds === null) return '--:--';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export const RoundStatus = () => {
  const { state } = useGame();
  const round = state.publicState?.round;
  if (!round) return null;
  const warning = state.remainingSeconds !== null && state.remainingSeconds <= 10 &&
    state.remainingSeconds > 0 && round.status === 'DRAWING_AND_GUESSING';
  const label = {
    PREPARING_KEYWORD: '제시어 준비',
    DRAWING_AND_GUESSING: '그리는 중',
    SOLVED: '정답 확정',
    EXPIRED: '시간 종료'
  }[round.status];
  return (
    <div className={`round-status ${warning ? 'warning' : ''}`}>
      <span>{round.roundNumber}라운드 · {label}</span>
      <time className="countdown">{formatTime(round.status === 'EXPIRED' ? 0 : state.remainingSeconds)}</time>
      {warning && <span className="warning-text" aria-live="assertive">시간 얼마 남지 않음</span>}
    </div>
  );
};
