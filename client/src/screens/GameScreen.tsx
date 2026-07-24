import { useCallback, useEffect, useRef, useState } from 'react';
import { DrawingCanvas } from '../components/canvas/DrawingCanvas.js';
import {
  DrawingToolbar,
  type ToolSettings
} from '../components/canvas/DrawingToolbar.js';
import { KeywordPanel } from '../components/canvas/KeywordPanel.js';
import { GuessFeed } from '../components/game/GuessFeed.js';
import { GuessInput } from '../components/game/GuessInput.js';
import { PlayerList } from '../components/game/PlayerList.js';
import { RoundStatus } from '../components/game/RoundStatus.js';
import { ConfirmationModal } from '../components/feedback/ConfirmationModal.js';
import { useGame } from '../state/GameContext.js';

const durationText = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest}초`;
  if (!rest) return `${minutes}분`;
  return `${minutes}분 ${rest}초`;
};

const formatCountdown = (seconds: number | null): string => {
  if (seconds === null) return '--:--';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${
    String(seconds % 60).padStart(2, '0')
  }`;
};

type ConfirmationKind = 'LEAVE' | 'CLEAR' | 'RETURN_TO_WAITING';

const CONFIRMATION_COPY: Record<ConfirmationKind, {
  title: string;
  message: string;
  confirmLabel: string;
}> = {
  LEAVE: {
    title: '방 나가기',
    message: '방을 나가시겠습니까?',
    confirmLabel: '나가기'
  },
  CLEAR: {
    title: '그림 전체 지우기',
    message: '현재 그림을 모두 지우시겠습니까?',
    confirmLabel: '전체 지우기'
  },
  RETURN_TO_WAITING: {
    title: '대기실로 돌아가기',
    message: '현재 라운드를 끝내고 대기실로 돌아가시겠습니까? 누적 점수는 유지됩니다.',
    confirmLabel: '대기실로 돌아가기'
  }
};

export const GameScreen = ({
  bgmVolume,
  onBgmVolumeChange
}: {
  bgmVolume: number;
  onBgmVolumeChange: (volume: number) => void;
}) => {
  const { state, send, resetToLobby } = useGame();
  const publicState = state.publicState;
  const session = state.session;
  const [settings, setSettings] = useState<ToolSettings>({
    tool: 'PEN',
    color: 'BLACK',
    width: 'MEDIUM'
  });
  const [durationDraft, setDurationDraft] = useState<number | null>(null);
  const [bgmControlOpen, setBgmControlOpen] = useState(false);
  const [roomCodeOpen, setRoomCodeOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationKind | null>(null);
  const bgmControlRef = useRef<HTMLDivElement>(null);
  const roomCodeButtonRef = useRef<HTMLButtonElement>(null);
  const roomCodeCloseRef = useRef<HTMLButtonElement>(null);
  const closeConfirmation = useCallback(() => setConfirmation(null), []);
  useEffect(() => {
    if (!bgmControlOpen) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!bgmControlRef.current?.contains(event.target as Node)) setBgmControlOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setBgmControlOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [bgmControlOpen]);
  useEffect(() => {
    if (!roomCodeOpen) return;
    const triggerButton = roomCodeButtonRef.current;
    roomCodeCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setRoomCodeOpen(false);
      if (event.key === 'Tab') {
        event.preventDefault();
        roomCodeCloseRef.current?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      triggerButton?.focus();
    };
  }, [roomCodeOpen]);
  if (!publicState || !session) return <main className="room-loading">방 상태를 불러오고 있습니다.</main>;

  const me = publicState.players.find((player) => player.playerId === session.playerId);
  const actions = new Set(state.privateState?.allowedActions ?? []);
  const canDraw = actions.has('DRAW_STROKE_BATCH');
  const canUndo = actions.has('UNDO_LAST_STROKE') &&
    state.drawing.strokes.some((stroke) => stroke.finalized && !stroke.undone);
  const round = publicState.round;
  const duration = durationDraft ?? round.durationSeconds;
  const hostAbsent = publicState.hostDisconnectedAt !== null;
  const roles = [
    me?.isHost ? '호스트' : null,
    me?.isModerator ? '진행자' : null,
    publicState.drawerId === session.playerId ? '그리기' : null,
    actions.has('SUBMIT_GUESS') ? '추측' : null
  ].filter(Boolean);

  const leave = (): void => {
    if (!send('LEAVE_ROOM', {})) return;
    if (!me?.isHost) resetToLobby();
  };
  const clear = (): void => {
    send('CLEAR_DRAWING', {
      roundId: round.roundId,
      drawingRevision: publicState.drawing.drawingRevision,
      drawerEpoch: publicState.drawerEpoch
    });
  };
  const returnToWaiting = (): void => {
    send('RETURN_TO_WAITING', { roundId: round.roundId });
  };
  const confirmAction = (): void => {
    const action = confirmation;
    setConfirmation(null);
    if (action === 'LEAVE') leave();
    if (action === 'CLEAR') clear();
    if (action === 'RETURN_TO_WAITING') returnToWaiting();
  };
  const answerModeLabel = publicState.answerMode === 'FIRST_CORRECT'
    ? '선착순 종료'
    : '타이머까지 계속';

  return (
    <main className="game-screen">
      <header className="game-header">
        <div className="header-cluster header-left">
          <button
            ref={roomCodeButtonRef}
            type="button"
            className="room-code-button"
            onClick={() => setRoomCodeOpen(true)}
            aria-label={`방번호 ${publicState.roomCode} 크게 보기`}
          >
            방 {publicState.roomCode}
          </button>
          <div className="identity">
            <strong>{session.nickname}</strong>
            <span>{roles.join(' · ') || '관람'}</span>
          </div>
        </div>
        <img
          className="header-title"
          src="/images/bg/header_title.webp"
          alt="Doodle Guess"
        />
        <div className="header-cluster header-right">
          <RoundStatus />
          <div className={`connection-chip ${state.connection.status === 'CONNECTED' ? 'connected' : ''}`}>
            {state.connection.status === 'CONNECTED' ? '연결됨' : '연결 확인 중'}
          </div>
          {me?.isHost && (
            <div className="bgm-control" ref={bgmControlRef}>
              <button
                type="button"
                className="ghost bgm-toggle"
                aria-label={`배경음 볼륨 조절 · 현재 ${Math.round(bgmVolume * 100)}%`}
                aria-expanded={bgmControlOpen}
                aria-controls="bgm-volume-panel"
                onClick={() => setBgmControlOpen((open) => !open)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M9 18V5.8L19 4v11.2M9 10l10-1.8M9 18c0 1.7-1.6 3-3.5 3S2 19.7 2 18s1.6-3 3.5-3S9 16.3 9 18Zm10-2.8c0 1.7-1.6 3-3.5 3s-3.5-1.3-3.5-3 1.6-3 3.5-3 3.5 1.3 3.5 3Z"
                  />
                  {bgmVolume === 0 && <path className="mute-slash" d="M3 3l18 18" />}
                </svg>
              </button>
              {bgmControlOpen && (
                <section id="bgm-volume-panel" className="bgm-volume-panel" aria-label="배경음 볼륨">
                  <label htmlFor="bgm-volume">볼륨 {Math.round(bgmVolume * 100)}%</label>
                  <input
                    id="bgm-volume"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(bgmVolume * 100)}
                    onChange={(event) => onBgmVolumeChange(Number(event.target.value) / 100)}
                  />
                </section>
              )}
            </div>
          )}
          <button type="button" className="danger" onClick={() => setConfirmation('LEAVE')}>
            나가기
          </button>
        </div>
      </header>

      {roomCodeOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setRoomCodeOpen(false);
          }}
        >
          <section
            className="modal room-code-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="room-code-modal-title"
            aria-describedby="room-code-modal-value"
          >
            <h2 id="room-code-modal-title">방번호</h2>
            <strong id="room-code-modal-value">{publicState.roomCode}</strong>
            <button
              ref={roomCodeCloseRef}
              type="button"
              className="primary"
              onClick={() => setRoomCodeOpen(false)}
            >
              닫기
            </button>
          </section>
        </div>
      )}

      {confirmation && (
        <ConfirmationModal
          {...CONFIRMATION_COPY[confirmation]}
          onConfirm={confirmAction}
          onCancel={closeConfirmation}
        />
      )}

      {hostAbsent && (
        <div className="status-banner warning-banner">
          호스트 연결이 끊겼습니다 · 방 종료까지{' '}
          {formatCountdown(state.hostAbsenceRemainingSeconds)}
        </div>
      )}
      {round.status === 'SOLVED' && (
        <div className="status-banner success-banner">정답 확정 · {round.winnerNickname}</div>
      )}
      {round.status === 'DRAWING_AND_GUESSING' &&
        publicState.answerMode === 'UNTIL_TIMER' &&
        round.correctCount > 0 && (
          <div className="status-banner success-banner">
            정답 {round.correctCount}명 · 타이머가 끝날 때까지 계속 진행
          </div>
        )}
      {round.status === 'EXPIRED' && (
        <div className="status-banner">
          {publicState.answerMode === 'UNTIL_TIMER'
            ? `라운드 종료 · 정답 ${round.correctCount}명`
            : '시간 종료'} · 대기실 복귀를 기다리는 중
        </div>
      )}

      <div className="room-layout">
        <PlayerList />
        <section className="canvas-column">
          <DrawingCanvas enabled={canDraw} settings={settings} />
          {canDraw && (
            <DrawingToolbar
              settings={settings}
              onChange={setSettings}
              disabled={!canDraw}
              canUndo={canUndo}
              onUndo={() => send('UNDO_LAST_STROKE', {
                roundId: round.roundId,
                drawingRevision: publicState.drawing.drawingRevision,
                drawerEpoch: publicState.drawerEpoch
              })}
              onClear={() => setConfirmation('CLEAR')}
            />
          )}
          <GuessInput />
        </section>
        <aside className="control-panel">
          <section className="answer-mode-panel panel-section">
            <h3>정답 판정 모드</h3>
            {actions.has('SET_ANSWER_MODE') ? (
              <fieldset>
                <legend className="visually-hidden">정답 판정 모드 선택</legend>
                <label>
                  <input
                    type="radio"
                    name="answer-mode"
                    checked={publicState.answerMode === 'UNTIL_TIMER'}
                    onChange={() => send('SET_ANSWER_MODE', { answerMode: 'UNTIL_TIMER' })}
                  />
                  타이머까지 계속
                </label>
                <label>
                  <input
                    type="radio"
                    name="answer-mode"
                    checked={publicState.answerMode === 'FIRST_CORRECT'}
                    onChange={() => send('SET_ANSWER_MODE', { answerMode: 'FIRST_CORRECT' })}
                  />
                  선착순 종료
                </label>
              </fieldset>
            ) : (
              <>
                <p>{answerModeLabel}</p>
                {round.status === 'DRAWING_AND_GUESSING' &&
                  <small>라운드 진행 중에는 모드를 바꿀 수 없습니다.</small>}
              </>
            )}
            <small>
              {publicState.answerMode === 'FIRST_CORRECT'
                ? '첫 정답이 나오면 바로 라운드가 끝납니다.'
                : '정답은 가려지고, 정답자는 1점씩·그림 담당자는 최대 1점을 받습니다.'}
            </small>
          </section>
          {actions.has('SET_ROUND_DURATION') ? (
            <section className="duration-panel panel-section">
              <label htmlFor="round-duration">제한 시간</label>
              <input
                id="round-duration"
                type="range"
                min="20"
                max="180"
                step="5"
                value={duration}
                aria-valuetext={durationText(duration)}
                onChange={(event) => setDurationDraft(Number(event.target.value))}
                onPointerUp={() => {
                  send('SET_ROUND_DURATION', { durationSeconds: duration });
                  setDurationDraft(null);
                }}
                onBlur={() => {
                  if (duration !== round.durationSeconds) {
                    send('SET_ROUND_DURATION', { durationSeconds: duration });
                  }
                  setDurationDraft(null);
                }}
              />
              <output htmlFor="round-duration">{durationText(duration)}</output>
            </section>
          ) : (
            <section className="duration-panel panel-section">
              <h3>제한 시간</h3>
              <p>{durationText(round.durationSeconds)}</p>
              {round.status === 'DRAWING_AND_GUESSING' &&
                <small>라운드 진행 중에는 제한 시간을 바꿀 수 없습니다.</small>}
            </section>
          )}
          <KeywordPanel />
          {actions.has('RECLAIM_DRAWER') && (
            <section className="panel-section">
              <p>기존 그림과 제시어를 유지한 채 그리기 권한을 가져옵니다.</p>
              <button type="button" className="secondary" onClick={() => send('RECLAIM_DRAWER', {})}>
                그리기 권한 가져오기
              </button>
            </section>
          )}
          {actions.has('RETURN_TO_WAITING') && (
            <button
              type="button"
              className="secondary next-round"
              onClick={() => setConfirmation('RETURN_TO_WAITING')}
            >
              대기실로 돌아가기
            </button>
          )}
          <GuessFeed />
        </aside>
      </div>
    </main>
  );
};
