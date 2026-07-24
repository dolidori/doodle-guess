import type {
  AuthoritativeDrawing,
  GuessPublic,
  PrivateState,
  PublicState,
  RoomSession,
  Stroke,
  StrokeBatchEvent
} from '../../../shared/src/index.js';

export type ConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'FAILED';

export type ModalItem = {
  key: string;
  kind: 'SOLVED' | 'EXPIRED' | 'RESULTS' | 'CONFIRM_LEAVE' | 'CONFIRM_CLEAR' | 'ROOM_CODE';
  title: string;
  message: string;
  answer?: string;
  rankings?: Array<{
    rank: number;
    playerId: string;
    nickname: string;
    score: number;
  }>;
};

export type ToastItem = {
  id: string;
  message: string;
  kind: 'info' | 'error';
};

export type GameState = {
  connection: {
    status: ConnectionStatus;
    attempts: number;
  };
  screen: 'LOBBY' | 'ROOM' | 'KICKED' | 'CLOSED';
  session: RoomSession | null;
  publicState: PublicState | null;
  privateState: PrivateState | null;
  drawing: AuthoritativeDrawing;
  keywordHidden: boolean;
  remainingSeconds: number | null;
  hostAbsenceRemainingSeconds: number | null;
  modalQueue: ModalItem[];
  toastQueue: ToastItem[];
  consumedEventIds: Set<string>;
  blockingMessage: string | null;
};

export const initialState: GameState = {
  connection: { status: 'CONNECTING', attempts: 0 },
  screen: 'LOBBY',
  session: null,
  publicState: null,
  privateState: null,
  drawing: { roundId: null, drawingRevision: 0, drawingSeq: 0, strokes: [] },
  keywordHidden: true,
  remainingSeconds: null,
  hostAbsenceRemainingSeconds: null,
  modalQueue: [],
  toastQueue: [],
  consumedEventIds: new Set(),
  blockingMessage: null
};

export type GameAction =
  | { type: 'CONNECTION'; status: ConnectionStatus; attempts?: number }
  | { type: 'SESSION'; session: RoomSession }
  | { type: 'PUBLIC_STATE'; state: PublicState }
  | { type: 'PRIVATE_STATE'; state: PrivateState }
  | { type: 'GUESS_SHARED'; guess: GuessPublic }
  | { type: 'STROKE_BATCH'; event: StrokeBatchEvent }
  | {
      type: 'STROKE_UNDONE';
      roundId: string;
      drawingRevision: number;
      strokeId: string;
      drawingSeq: number;
    }
  | { type: 'DRAWING_CLEARED'; roundId: string; drawingRevision: number }
  | { type: 'DRAWING_SNAPSHOT'; drawing: AuthoritativeDrawing }
  | { type: 'ROUND_SOLVED'; payload: any }
  | { type: 'ROUND_EXPIRED'; payload: any }
  | { type: 'TOGGLE_KEYWORD' }
  | {
      type: 'SET_CLOCK_DISPLAY';
      remainingSeconds: number | null;
      hostAbsenceRemainingSeconds: number | null;
    }
  | { type: 'TOAST'; toast: ToastItem }
  | { type: 'DISMISS_TOAST'; id: string }
  | { type: 'DISMISS_MODAL' }
  | { type: 'OPEN_MODAL'; modal: ModalItem }
  | { type: 'KICKED' }
  | { type: 'ROOM_CLOSED'; message: string }
  | { type: 'RESET_TO_LOBBY' };

const mergeGuess = (feed: GuessPublic[], guess: GuessPublic): GuessPublic[] => {
  if (feed.some((item) => item.roundId === guess.roundId && item.guessSeq === guess.guessSeq)) return feed;
  return [...feed, guess].sort((a, b) => a.guessSeq - b.guessSeq).slice(-100);
};

const applyStrokeBatch = (
  drawing: AuthoritativeDrawing,
  event: StrokeBatchEvent
): AuthoritativeDrawing => {
  if (drawing.roundId !== event.roundId || drawing.drawingRevision !== event.drawingRevision) {
    return drawing;
  }
  if (event.drawingSeq <= drawing.drawingSeq) return drawing;
  if (event.drawingSeq !== drawing.drawingSeq + 1) return drawing;
  const existing = drawing.strokes.find((stroke) => stroke.strokeId === event.strokeId);
  let strokes: Stroke[];
  if (existing) {
    strokes = drawing.strokes.map((stroke) => stroke.strokeId === event.strokeId ? {
      ...stroke,
      points: [...stroke.points, ...event.points],
      finalized: event.isFinal,
      lastBatchSeq: event.batchSeq
    } : stroke);
  } else {
    strokes = [...drawing.strokes, {
      strokeId: event.strokeId,
      authorId: event.authorId,
      roundId: event.roundId,
      drawingRevision: event.drawingRevision,
      drawerEpoch: event.drawerEpoch,
      tool: event.tool,
      color: event.color,
      width: event.width,
      points: event.points,
      finalized: event.isFinal,
      lastBatchSeq: event.batchSeq,
      undone: false,
      createdAt: Date.now()
    }];
  }
  return { ...drawing, drawingSeq: event.drawingSeq, strokes };
};

export const gameReducer = (state: GameState, action: GameAction): GameState => {
  switch (action.type) {
    case 'CONNECTION':
      return {
        ...state,
        connection: { status: action.status, attempts: action.attempts ?? state.connection.attempts }
      };
    case 'SESSION':
      return {
        ...state,
        screen: 'ROOM',
        session: action.session,
        blockingMessage: null,
        keywordHidden: true
      };
    case 'PUBLIC_STATE': {
      if (state.publicState && action.state.roomVersion < state.publicState.roomVersion) return state;
      const changedRound = state.publicState?.round.roundId !== action.state.round.roundId;
      const ceremonyEnded = state.publicState?.status === 'RESULTS' &&
        action.state.status === 'WAITING';
      const enteredCeremony = action.state.status === 'RESULTS' &&
        action.state.finalRankings !== null &&
        !state.modalQueue.some((modal) => modal.kind === 'RESULTS');
      const consumedEventIds = new Set(state.consumedEventIds);
      if (action.state.round.lastRoundEventId &&
          (action.state.round.status === 'SOLVED' || action.state.round.status === 'EXPIRED')) {
        consumedEventIds.add(action.state.round.lastRoundEventId);
      }
      return {
        ...state,
        publicState: action.state,
        drawing: changedRound ? {
          roundId: action.state.round.roundId,
          drawingRevision: action.state.drawing.drawingRevision,
          drawingSeq: 0,
          strokes: []
        } : state.drawing,
        keywordHidden: changedRound ? true : state.keywordHidden,
        modalQueue: ceremonyEnded
          ? state.modalQueue.filter((modal) => modal.kind !== 'RESULTS')
          : enteredCeremony
            ? [...state.modalQueue, {
                key: `game-results:${action.state.round.roundId}`,
                kind: 'RESULTS',
                title: '최종 시상식',
                message: '모든 순환 그리기가 끝났습니다.',
                rankings: action.state.finalRankings!
              }]
            : state.modalQueue,
        consumedEventIds
      };
    }
    case 'PRIVATE_STATE':
      return {
        ...state,
        privateState: action.state,
        keywordHidden: state.privateState?.roundId !== action.state.roundId ? true : state.keywordHidden
      };
    case 'GUESS_SHARED':
      if (!state.publicState || state.publicState.round.roundId !== action.guess.roundId) return state;
      return {
        ...state,
        publicState: {
          ...state.publicState,
          guessFeed: mergeGuess(state.publicState.guessFeed, action.guess)
        }
      };
    case 'STROKE_BATCH':
      return { ...state, drawing: applyStrokeBatch(state.drawing, action.event) };
    case 'STROKE_UNDONE':
      if (
        state.drawing.roundId !== action.roundId ||
        state.drawing.drawingRevision !== action.drawingRevision ||
        action.drawingSeq !== state.drawing.drawingSeq + 1
      ) {
        return state;
      }
      return {
        ...state,
        drawing: {
          ...state.drawing,
          drawingSeq: action.drawingSeq,
          strokes: state.drawing.strokes.map((stroke) =>
            stroke.strokeId === action.strokeId ? { ...stroke, undone: true } : stroke
          )
        }
      };
    case 'DRAWING_CLEARED':
      return {
        ...state,
        drawing: {
          roundId: action.roundId,
          drawingRevision: action.drawingRevision,
          drawingSeq: 0,
          strokes: []
        }
      };
    case 'DRAWING_SNAPSHOT':
      return { ...state, drawing: action.drawing };
    case 'ROUND_SOLVED': {
      if (state.consumedEventIds.has(action.payload.eventId)) return state;
      const consumed = new Set(state.consumedEventIds).add(action.payload.eventId);
      const answer = typeof action.payload.answerText === 'string'
        ? action.payload.answerText
        : undefined;
      return {
        ...state,
        consumedEventIds: consumed,
        modalQueue: [...state.modalQueue, {
          key: `round-solved:${action.payload.eventId}`,
          kind: 'SOLVED',
          title: answer ? '정답 공개' : '정답을 맞혔습니다',
          message: `${action.payload.winnerNickname}님이 가장 먼저 맞혔습니다.`,
          ...(answer ? { answer } : {})
        }]
      };
    }
    case 'ROUND_EXPIRED': {
      if (state.consumedEventIds.has(action.payload.eventId)) return state;
      const consumed = new Set(state.consumedEventIds).add(action.payload.eventId);
      const answer = typeof action.payload.answerText === 'string'
        ? action.payload.answerText
        : undefined;
      return {
        ...state,
        consumedEventIds: consumed,
        modalQueue: [...state.modalQueue, {
          key: `round-expired:${action.payload.eventId}`,
          kind: 'EXPIRED',
          title: answer
            ? '정답 공개'
            : action.payload.answerMode === 'UNTIL_TIMER' ? '라운드 종료' : '시간 종료',
          message: action.payload.answerMode === 'UNTIL_TIMER'
            ? action.payload.correctCount > 0
              ? `${action.payload.correctCount}명이 정답을 맞혔습니다.`
              : '이번 라운드에는 정답자가 없습니다.'
            : '제한 시간이 끝났습니다.',
          ...(answer ? { answer } : {})
        }]
      };
    }
    case 'TOGGLE_KEYWORD':
      return { ...state, keywordHidden: !state.keywordHidden };
    case 'SET_CLOCK_DISPLAY':
      return {
        ...state,
        remainingSeconds: action.remainingSeconds,
        hostAbsenceRemainingSeconds: action.hostAbsenceRemainingSeconds
      };
    case 'TOAST':
      return { ...state, toastQueue: [...state.toastQueue, action.toast].slice(-3) };
    case 'DISMISS_TOAST':
      return { ...state, toastQueue: state.toastQueue.filter((toast) => toast.id !== action.id) };
    case 'DISMISS_MODAL':
      return { ...state, modalQueue: state.modalQueue.slice(1) };
    case 'OPEN_MODAL':
      return { ...state, modalQueue: [...state.modalQueue, action.modal] };
    case 'KICKED':
      return {
        ...initialState,
        connection: state.connection,
        screen: 'KICKED',
        blockingMessage: '방에서 내보내졌습니다.'
      };
    case 'ROOM_CLOSED':
      return {
        ...initialState,
        connection: state.connection,
        screen: 'CLOSED',
        blockingMessage: action.message
      };
    case 'RESET_TO_LOBBY':
      return { ...initialState, connection: state.connection };
  }
};
