import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode
} from 'react';
import { HOST_ABSENCE_TTL_MS } from '../../../shared/src/index.js';
import type {
  AllowedAction,
  ClientEventType,
  ClientPayloadMap,
  DrawingSnapshotPayload,
  ErrorPayload,
  GuessPublic,
  PrivateState,
  PublicState,
  RoomSession,
  StrokeBatchEvent
} from '../../../shared/src/index.js';
import { SnapshotAssembler } from '../realtime/snapshotAssembler.js';
import {
  remainingSeconds as calculateRemaining,
  syncServerClock,
  type ClockAnchor
} from '../realtime/serverClock.js';
import {
  advanceDrawingSequence,
  cursorFromDrawing
} from '../realtime/drawingSequence.js';
import { openWebSocket } from '../realtime/websocketClient.js';
import {
  gameReducer,
  initialState,
  type GameAction,
  type GameState
} from './gameReducer.js';

type Send = <T extends ClientEventType>(type: T, payload: ClientPayloadMap[T]) => string | null;

type GameContextValue = {
  state: GameState;
  send: Send;
  createRoom: (nickname: string, mode: 'NORMAL' | 'MODERATOR') => void;
  joinRoom: (roomCode: string, nickname: string) => void;
  dispatch: React.Dispatch<GameAction>;
  resetToLobby: () => void;
};

const GameContext = createContext<GameContextValue | null>(null);
const SESSION_KEY = 'doodle-guess-current-session';
const RECENT_KEY = 'doodle-guess-recent-rooms';
const SNAPSHOT_TIMEOUT_MS = 5000;

type StoredSession = {
  roomCode: string;
  nickname: string;
  sessionToken: string;
};

const readStoredSession = (): StoredSession | null => {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as unknown;
    if (
      typeof value !== 'object' ||
      value === null ||
      !('roomCode' in value) ||
      !('nickname' in value) ||
      !('sessionToken' in value) ||
      typeof value.roomCode !== 'string' ||
      typeof value.nickname !== 'string' ||
      typeof value.sessionToken !== 'string'
    ) {
      return null;
    }
    return {
      roomCode: value.roomCode,
      nickname: value.nickname,
      sessionToken: value.sessionToken
    };
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
};

const roomCloseMessage = (reason: string): string => {
  if (reason === 'HOST_LEFT') return '호스트가 나가 방이 종료되었습니다.';
  if (reason === 'HOST_ABSENT_TIMEOUT') return '호스트가 돌아오지 않아 방이 종료되었습니다.';
  return '서버가 다시 시작되어 기존 방이 종료되었습니다.';
};

const actionForEvent = (type: ClientEventType): AllowedAction | null =>
  type === 'CREATE_ROOM' || type === 'JOIN_ROOM' ? null : type;

export const GameProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const stateRef = useRef(state);
  const socketRef = useRef<WebSocket | null>(null);
  const disposedRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectSessionRef = useRef<StoredSession | null>(null);
  const assemblerRef = useRef(new SnapshotAssembler());
  const clockRef = useRef<ClockAnchor | null>(null);
  const warnedRoundRef = useRef<string | null>(null);
  const drawingSequenceRef = useRef(cursorFromDrawing(initialState.drawing));
  const snapshotActiveRef = useRef(false);
  const pendingSnapshotDeltasRef = useRef<StrokeBatchEvent[]>([]);
  const snapshotTimerRef = useRef<number | null>(null);
  useEffect(() => {
    stateRef.current = state;
    const current = drawingSequenceRef.current;
    const rendered = cursorFromDrawing(state.drawing);
    if (
      current.roundId !== rendered.roundId ||
      current.drawingRevision !== rendered.drawingRevision ||
      rendered.drawingSeq > current.drawingSeq
    ) {
      drawingSequenceRef.current = rendered;
    }
  }, [state]);

  const toast = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    const id = crypto.randomUUID();
    dispatch({ type: 'TOAST', toast: { id, message, kind } });
    window.setTimeout(() => dispatch({ type: 'DISMISS_TOAST', id }), kind === 'error' ? 4000 : 2200);
  }, []);

  const rememberSession = useCallback((session: RoomSession) => {
    const stored: StoredSession = {
      roomCode: session.roomCode,
      nickname: session.nickname,
      sessionToken: session.sessionToken
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    reconnectSessionRef.current = stored;
    const previous = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Array<{
      roomCode: string;
      nickname: string;
      visitedAt: number;
    }>;
    const recent = [
      { roomCode: session.roomCode, nickname: session.nickname, visitedAt: Date.now() },
      ...previous.filter((item) =>
        item.roomCode !== session.roomCode || item.nickname !== session.nickname
      )
    ].slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  }, []);

  const handleMessage = useCallback(async (message: MessageEvent<string>) => {
    const event = JSON.parse(message.data) as {
      type: string;
      payload: any;
      roomVersion?: number;
    };
    switch (event.type) {
      case 'ROOM_SESSION':
        rememberSession(event.payload as RoomSession);
        dispatch({ type: 'SESSION', session: event.payload as RoomSession });
        if ((event.payload as RoomSession).isReconnect) toast('재연결되었습니다.');
        break;
      case 'PUBLIC_STATE':
        dispatch({ type: 'PUBLIC_STATE', state: event.payload as PublicState });
        break;
      case 'PRIVATE_STATE':
        dispatch({ type: 'PRIVATE_STATE', state: event.payload as PrivateState });
        break;
      case 'GUESS_SHARED':
        dispatch({ type: 'GUESS_SHARED', guess: event.payload as GuessPublic });
        break;
      case 'STROKE_BATCH': {
        const stroke = event.payload as StrokeBatchEvent;
        if (snapshotActiveRef.current) {
          pendingSnapshotDeltasRef.current.push(stroke);
          break;
        }
        const sequence = advanceDrawingSequence(drawingSequenceRef.current, stroke);
        if (sequence.status === 'GAP') {
          socketRef.current?.close(4000, '그림 동기화가 필요합니다.');
          break;
        }
        if (sequence.status === 'IGNORE') break;
        drawingSequenceRef.current = sequence.cursor;
        dispatch({ type: 'STROKE_BATCH', event: stroke });
        break;
      }
      case 'STROKE_UNDONE': {
        const sequence = advanceDrawingSequence(drawingSequenceRef.current, {
          roundId: event.payload.roundId as string,
          drawingRevision: event.payload.drawingRevision as number,
          drawingSeq: event.payload.drawingSeq as number
        });
        if (sequence.status === 'GAP') {
          socketRef.current?.close(4000, '그림 동기화가 필요합니다.');
          break;
        }
        if (sequence.status === 'IGNORE') break;
        drawingSequenceRef.current = sequence.cursor;
        dispatch({
          type: 'STROKE_UNDONE',
          roundId: event.payload.roundId as string,
          drawingRevision: event.payload.drawingRevision as number,
          strokeId: event.payload.strokeId as string,
          drawingSeq: event.payload.drawingSeq as number
        });
        break;
      }
      case 'DRAWING_CLEARED':
        assemblerRef.current.clear();
        snapshotActiveRef.current = false;
        pendingSnapshotDeltasRef.current = [];
        if (snapshotTimerRef.current !== null) {
          clearTimeout(snapshotTimerRef.current);
          snapshotTimerRef.current = null;
        }
        drawingSequenceRef.current = {
          roundId: event.payload.roundId as string,
          drawingRevision: event.payload.drawingRevision as number,
          drawingSeq: 0
        };
        dispatch({
          type: 'DRAWING_CLEARED',
          roundId: event.payload.roundId as string,
          drawingRevision: event.payload.drawingRevision as number
        });
        break;
      case 'DRAWING_SNAPSHOT':
        try {
          snapshotActiveRef.current = true;
          if (snapshotTimerRef.current === null) {
            snapshotTimerRef.current = window.setTimeout(() => {
              snapshotTimerRef.current = null;
              if (!snapshotActiveRef.current) return;
              assemblerRef.current.clear();
              pendingSnapshotDeltasRef.current = [];
              socketRef.current?.close(4000, '그림 스냅샷 청크가 누락되었습니다.');
            }, SNAPSHOT_TIMEOUT_MS);
          }
          const drawing = await assemblerRef.current.add(event.payload as DrawingSnapshotPayload);
          if (drawing) {
            if (snapshotTimerRef.current !== null) {
              clearTimeout(snapshotTimerRef.current);
              snapshotTimerRef.current = null;
            }
            drawingSequenceRef.current = cursorFromDrawing(drawing);
            dispatch({ type: 'DRAWING_SNAPSHOT', drawing });
            for (const delta of pendingSnapshotDeltasRef.current
              .filter((item) =>
                item.roundId === drawing.roundId &&
                item.drawingRevision === drawing.drawingRevision &&
                item.drawingSeq > drawing.drawingSeq
              )
              .sort((a, b) => a.drawingSeq - b.drawingSeq)) {
              const sequence = advanceDrawingSequence(drawingSequenceRef.current, delta);
              if (sequence.status !== 'APPLY') continue;
              drawingSequenceRef.current = sequence.cursor;
              dispatch({ type: 'STROKE_BATCH', event: delta });
            }
            pendingSnapshotDeltasRef.current = [];
            snapshotActiveRef.current = false;
          }
        } catch {
          if (snapshotTimerRef.current !== null) {
            clearTimeout(snapshotTimerRef.current);
            snapshotTimerRef.current = null;
          }
          snapshotActiveRef.current = false;
          pendingSnapshotDeltasRef.current = [];
          socketRef.current?.close(4000, '그림 스냅샷 검증 실패');
        }
        break;
      case 'ROUND_SOLVED':
        dispatch({ type: 'ROUND_SOLVED', payload: event.payload });
        break;
      case 'ROUND_EXPIRED':
        dispatch({ type: 'ROUND_EXPIRED', payload: event.payload });
        break;
      case 'ERROR': {
        const error = event.payload as ErrorPayload;
        toast(error.message, 'error');
        if (error.code === 'ROOM_NOT_FOUND') {
          sessionStorage.removeItem(SESSION_KEY);
          dispatch({ type: 'ROOM_CLOSED', message: '서버가 다시 시작되어 기존 방이 종료되었습니다.' });
        }
        break;
      }
      case 'KICKED':
        sessionStorage.removeItem(SESSION_KEY);
        reconnectSessionRef.current = null;
        dispatch({ type: 'KICKED' });
        break;
      case 'PLAYER_KICKED':
        toast(`${event.payload.nickname as string}님이 방에서 나갔습니다.`);
        break;
      case 'ROOM_CLOSED':
        sessionStorage.removeItem(SESSION_KEY);
        reconnectSessionRef.current = null;
        dispatch({ type: 'ROOM_CLOSED', message: roomCloseMessage(event.payload.reason as string) });
        break;
    }
  }, [rememberSession, toast]);

  const connectRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    connectRef.current = () => {
      if (disposedRef.current) return;
      const reconnecting = reconnectSessionRef.current !== null;
      dispatch({
        type: 'CONNECTION',
        status: reconnecting ? 'RECONNECTING' : 'CONNECTING',
        attempts: reconnectAttemptsRef.current
      });
      const socket = openWebSocket();
      socketRef.current = socket;
      socket.addEventListener('open', () => {
        reconnectAttemptsRef.current = 0;
        dispatch({ type: 'CONNECTION', status: 'CONNECTED', attempts: 0 });
        const stored = reconnectSessionRef.current;
        if (stored) {
          socket.send(JSON.stringify({
            v: 1,
            type: 'JOIN_ROOM',
            requestId: crypto.randomUUID(),
            payload: stored
          }));
        }
      });
      socket.addEventListener('message', (message) => void handleMessage(message));
      socket.addEventListener('close', () => {
        if (disposedRef.current || socketRef.current !== socket) return;
        socketRef.current = null;
        if (snapshotTimerRef.current !== null) {
          clearTimeout(snapshotTimerRef.current);
          snapshotTimerRef.current = null;
        }
        snapshotActiveRef.current = false;
        assemblerRef.current.clear();
        pendingSnapshotDeltasRef.current = [];
        if (stateRef.current.screen !== 'ROOM' || !reconnectSessionRef.current) {
          dispatch({ type: 'CONNECTION', status: 'FAILED' });
          return;
        }
        reconnectAttemptsRef.current += 1;
        dispatch({
          type: 'CONNECTION',
          status: 'RECONNECTING',
          attempts: reconnectAttemptsRef.current
        });
        const delay = Math.min(5000, 500 * 2 ** Math.min(4, reconnectAttemptsRef.current - 1));
        reconnectTimerRef.current = window.setTimeout(() => connectRef.current(), delay);
      });
      socket.addEventListener('error', () => socket.close());
    };
  }, [handleMessage]);

  useEffect(() => {
    disposedRef.current = false;
    reconnectSessionRef.current = readStoredSession();
    connectRef.current();
    return () => {
      disposedRef.current = true;
      if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
      if (snapshotTimerRef.current !== null) clearTimeout(snapshotTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const synchronizeClock = useCallback(async (samples = 1) => {
    try {
      clockRef.current = await syncServerClock(samples);
    } catch {
      // PUBLIC_STATE.serverNow remains the temporary display basis.
    }
  }, []);

  useEffect(() => {
    if (state.connection.status !== 'CONNECTED') return;
    void synchronizeClock(3);
    const active = state.publicState?.round.status === 'DRAWING_AND_GUESSING';
    const syncTimer = active ? window.setInterval(() => void synchronizeClock(1), 15_000) : null;
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) connectRef.current();
        void synchronizeClock(1);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (syncTimer !== null) clearInterval(syncTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [state.connection.status, state.publicState?.round.status, synchronizeClock]);

  const clockRoundId = state.publicState?.round.roundId;
  const clockRoundEndsAt = state.publicState?.round.roundEndsAt;
  const clockRoundStatus = state.publicState?.round.status;
  const clockHostDisconnectedAt = state.publicState?.hostDisconnectedAt;
  useEffect(() => {
    warnedRoundRef.current = null;
  }, [clockRoundId]);
  useEffect(() => {
    const hasActiveRound =
      Boolean(clockRoundEndsAt) &&
      clockRoundStatus === 'DRAWING_AND_GUESSING' &&
      Boolean(clockRoundId);
    const hasAbsentHost = clockHostDisconnectedAt !== null && clockHostDisconnectedAt !== undefined;
    if (!hasActiveRound && !hasAbsentHost) {
      dispatch({
        type: 'SET_CLOCK_DISPLAY',
        remainingSeconds: clockRoundStatus === 'EXPIRED' ? 0 : null,
        hostAbsenceRemainingSeconds: null
      });
      return;
    }
    const roundId = clockRoundId;
    const update = (): void => {
      const anchor = clockRef.current;
      const remainingSeconds = hasActiveRound && clockRoundEndsAt
        ? anchor
          ? calculateRemaining(clockRoundEndsAt, anchor)
          : Math.max(0, Math.ceil((clockRoundEndsAt - Date.now()) / 1000))
        : clockRoundStatus === 'EXPIRED' ? 0 : null;
      const hostAbsenceRemainingSeconds = hasAbsentHost
        ? anchor
          ? calculateRemaining(clockHostDisconnectedAt + HOST_ABSENCE_TTL_MS, anchor)
          : Math.max(0, Math.ceil(
            (clockHostDisconnectedAt + HOST_ABSENCE_TTL_MS - Date.now()) / 1000
          ))
        : null;
      dispatch({
        type: 'SET_CLOCK_DISPLAY',
        remainingSeconds,
        hostAbsenceRemainingSeconds
      });
      if (
        remainingSeconds !== null &&
        remainingSeconds <= 10 &&
        remainingSeconds > 0 &&
        warnedRoundRef.current !== roundId
      ) {
        warnedRoundRef.current = roundId ?? null;
        toast('10초 남았습니다.');
      }
    };
    update();
    const scheduler = window.setInterval(update, 200);
    return () => clearInterval(scheduler);
  }, [
    clockHostDisconnectedAt,
    clockRoundId,
    clockRoundEndsAt,
    clockRoundStatus,
    toast
  ]);

  const send = useCallback<Send>((type, payload) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      toast('서버에 연결되어 있지 않습니다.', 'error');
      return null;
    }
    const action = actionForEvent(type);
    if (action && !stateRef.current.privateState?.allowedActions.includes(action)) {
      toast('현재 상태에서는 이 동작을 할 수 없습니다.', 'error');
      return null;
    }
    const requestId = crypto.randomUUID();
    socket.send(JSON.stringify({ v: 1, type, requestId, payload }));
    return requestId;
  }, [toast]);

  const createRoom = useCallback((nickname: string, mode: 'NORMAL' | 'MODERATOR') => {
    reconnectSessionRef.current = null;
    send('CREATE_ROOM', { nickname, mode });
  }, [send]);

  const joinRoom = useCallback((roomCode: string, nickname: string) => {
    let token: string | undefined;
    try {
      const stored = readStoredSession();
      if (stored?.roomCode === roomCode && stored.nickname === nickname) token = stored.sessionToken;
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
    reconnectSessionRef.current = null;
    send('JOIN_ROOM', { roomCode, nickname, ...(token ? { sessionToken: token } : {}) });
  }, [send]);

  const resetToLobby = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    reconnectSessionRef.current = null;
    dispatch({ type: 'RESET_TO_LOBBY' });
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      reconnectAttemptsRef.current = 0;
      connectRef.current();
    }
  }, []);

  const value = useMemo<GameContextValue>(() => ({
    state,
    send,
    createRoom,
    joinRoom,
    dispatch,
    resetToLobby
  }), [state, send, createRoom, joinRoom, resetToLobby]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};

export const useGame = (): GameContextValue => {
  const value = useContext(GameContext);
  if (!value) throw new Error('GameProvider 안에서 사용해야 합니다.');
  return value;
};

export const recentRooms = (): Array<{ roomCode: string; nickname: string; visitedAt: number }> => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Array<{
      roomCode: string;
      nickname: string;
      visitedAt: number;
    }>;
  } catch {
    return [];
  }
};

export const removeRecentRoom = (roomCode: string, nickname: string): void => {
  const next = recentRooms().filter((item) => item.roomCode !== roomCode || item.nickname !== nickname);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
};
