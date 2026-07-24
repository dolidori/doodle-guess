import { WebSocket } from 'k6/websockets';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

/* global clearInterval, clearTimeout, console, open, setInterval, setTimeout */
const roomConfig = JSON.parse(open(__ENV.ROOM_CONFIG_PATH));
const normalConnectionsPerRoom = 29;
const roundSolveAfterMs = 40_000;

const strokeObserverLatency = new Trend('stroke_observer_latency_ms', true);
const guessSharedLatency = new Trend('guess_shared_latency_ms', true);
const guessSolvedLatency = new Trend('guess_solved_latency_ms', true);
const unexpectedErrors = new Counter('unexpected_errors');
const sequenceGaps = new Counter('drawing_sequence_gaps');
const duplicateEvents = new Counter('duplicate_events');
const crossRoomLeaks = new Counter('cross_room_leaks');
const normalConnectionDrops = new Counter('normal_connection_drops');
const roundsSolved = new Counter('rounds_solved');

const randomHex = (length) => {
  let value = '';
  while (value.length < length) value += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return value.slice(0, length);
};

const timedUuid = () => {
  const timestamp = Date.now().toString(16).padStart(12, '0').slice(-12);
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-4${randomHex(3)}-8${randomHex(3)}-${randomHex(12)}`;
};

const timestampFromUuid = (uuid) => Number.parseInt(`${uuid.slice(0, 8)}${uuid.slice(9, 13)}`, 16);

const send = (socket, type, payload) => {
  if (socket.readyState !== 1) return false;
  socket.send(JSON.stringify({
    v: 1,
    type,
    requestId: timedUuid(),
    payload
  }));
  return true;
};

class SocketAdapter {
  constructor(socket) {
    this.socket = socket;
    this.timeouts = new Set();
  }

  get readyState() {
    return this.socket.readyState;
  }

  on(event, listener) {
    this.socket.addEventListener(event, (message) => {
      if (event === 'message') listener(message.data);
      else if (event === 'close') listener(message.code);
      else listener(message);
    });
  }

  send(data) {
    this.socket.send(data);
  }

  close() {
    this.socket.close();
  }

  setTimeout(callback, delay) {
    let timeout;
    timeout = setTimeout(() => {
      this.timeouts.delete(timeout);
      callback();
    }, delay);
    this.timeouts.add(timeout);
    return timeout;
  }

  setInterval(callback, delay) {
    return setInterval(callback, delay);
  }

  clearTimeouts() {
    for (const timeout of this.timeouts) clearTimeout(timeout);
    this.timeouts.clear();
  }
}

export const loadOptions = (roomCount) => ({
  scenarios: {
    websocket_load: {
      executor: 'per-vu-iterations',
      vus: roomCount * normalConnectionsPerRoom,
      iterations: 1,
      maxDuration: __ENV.MAX_DURATION || '31m'
    }
  },
  thresholds: {
    stroke_observer_latency_ms: ['p(95)<150', 'p(99)<300'],
    'stroke_observer_latency_ms{phase:control}': ['p(95)<150'],
    'stroke_observer_latency_ms{phase:slow}': ['p(95)<150'],
    guess_solved_latency_ms: ['p(95)<200', 'p(99)<400'],
    checks: ['rate==1'],
    unexpected_errors: ['count==0'],
    drawing_sequence_gaps: ['count==0'],
    duplicate_events: ['count==0'],
    cross_room_leaks: ['count==0'],
    normal_connection_drops: ['count==0']
  }
});

export default function () {
  const vuIndex = exec.vu.idInTest - 1;
  const roomIndex = Math.floor(vuIndex / normalConnectionsPerRoom);
  const slotIndex = vuIndex % normalConnectionsPerRoom;
  const room = roomConfig.rooms[roomIndex];
  const isHost = slotIndex === 0;
  const nickname = isHost ? room.hostNickname : `참가${roomIndex}-${slotIndex}`;
  const joinPayload = {
    roomCode: room.roomCode,
    nickname,
    ...(isHost ? { sessionToken: room.hostSessionToken } : {})
  };

  let playerId = null;
  let currentState = null;
  let lastDrawingRevision = null;
  let lastDrawingSeq = 0;
  let scheduledGuessRoundId = null;
  let nextRoundRequestedFor = null;
  let startRequestedFor = null;
  let closedByTest = false;
  let connectionDropped = false;
  let connectionOpenedAt = 0;
  let drawingTimer = null;
  const solvedEventByRound = {};

  const socket = new SocketAdapter(
    new WebSocket(__ENV.WS_URL || 'ws://127.0.0.1:3001/ws')
  );
    socket.on('open', () => {
      connectionOpenedAt = Date.now();
      check(socket, {
        'websocket opens': (openedSocket) => openedSocket.readyState === 1
      });
      send(socket, 'JOIN_ROOM', joinPayload);
    });

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        unexpectedErrors.add(1);
        return;
      }

      if (message.type === 'ROOM_SESSION') {
        playerId = message.payload.playerId;
        return;
      }

      if (message.type === 'ERROR') {
        const expectedRaceError = message.payload.code === 'ROUND_LOCKED' ||
          message.payload.code === 'ROUND_EXPIRED' ||
          message.payload.code === 'STALE_ROUND';
        if (!expectedRaceError) {
          unexpectedErrors.add(1, { code: message.payload.code });
          console.error(`unexpected server error room=${room.roomCode} slot=${slotIndex} code=${message.payload.code}`);
        }
        return;
      }

      if (message.type === 'PUBLIC_STATE') {
        if (message.payload.roomCode !== room.roomCode) {
          crossRoomLeaks.add(1);
          return;
        }
        currentState = message.payload;
        lastDrawingRevision = currentState.drawing.drawingRevision;
        lastDrawingSeq = currentState.drawing.drawingSeq;
        const connectedPlayers = currentState.players.filter((player) => player.connected).length;
        if (
          isHost &&
          connectedPlayers >= 2 &&
          currentState.round.status === 'PREPARING_KEYWORD' &&
          startRequestedFor !== currentState.round.roundId
        ) {
          startRequestedFor = currentState.round.roundId;
          send(socket, 'SET_KEYWORD_AND_START', {
            roundId: currentState.round.roundId,
            keyword: '부하정답'
          });
        }
        if (
          !isHost &&
          currentState.round.status === 'DRAWING_AND_GUESSING' &&
          scheduledGuessRoundId !== currentState.round.roundId
        ) {
          scheduledGuessRoundId = currentState.round.roundId;
          const roundId = currentState.round.roundId;
          const startedAt = currentState.round.startedAt;
          for (let second = 1; second <= 10; second += 1) {
            socket.setTimeout(() => {
              if (currentState?.round.roundId !== roundId ||
                currentState.round.status !== 'DRAWING_AND_GUESSING') return;
              send(socket, 'SUBMIT_GUESS', {
                roundId,
                guessId: timedUuid(),
                text: `오답-${slotIndex}-${second}`
              });
            }, Math.max(1, startedAt + second * 1_000 - Date.now()));
          }
          socket.setTimeout(() => {
            if (currentState?.round.roundId !== roundId ||
              currentState.round.status !== 'DRAWING_AND_GUESSING') return;
            send(socket, 'SUBMIT_GUESS', {
              roundId,
              guessId: timedUuid(),
              text: '부하정답'
            });
          }, Math.max(1, startedAt + roundSolveAfterMs - Date.now()));
        }
        return;
      }

      if (message.type === 'DRAWING_CLEARED') {
        lastDrawingRevision = message.payload.drawingRevision;
        lastDrawingSeq = 0;
        return;
      }

      if (message.type === 'STROKE_BATCH') {
        const payload = message.payload;
        if (currentState && payload.authorId !== currentState.drawerId) {
          crossRoomLeaks.add(1);
          return;
        }
        if (!isHost) {
          const phase = Date.now() - connectionOpenedAt < 5 * 60_000 ? 'control' : 'slow';
          strokeObserverLatency.add(
            Math.max(0, Date.now() - timestampFromUuid(payload.strokeId)),
            { phase }
          );
          if (lastDrawingRevision === payload.drawingRevision) {
            if (payload.drawingSeq <= lastDrawingSeq) duplicateEvents.add(1);
            else if (payload.drawingSeq !== lastDrawingSeq + 1) sequenceGaps.add(1);
          }
          lastDrawingRevision = payload.drawingRevision;
          lastDrawingSeq = payload.drawingSeq;
        }
        return;
      }

      if (message.type === 'GUESS_SHARED') {
        guessSharedLatency.add(Math.max(0, Date.now() - timestampFromUuid(message.payload.guessId)));
        return;
      }

      if (message.type === 'ROUND_SOLVED') {
        const roundId = message.payload.roundId;
        guessSolvedLatency.add(Math.max(0, Date.now() - timestampFromUuid(message.payload.guessId)));
        if (solvedEventByRound[roundId] && solvedEventByRound[roundId] !== message.payload.eventId) {
          duplicateEvents.add(1);
        } else if (!solvedEventByRound[roundId]) {
          solvedEventByRound[roundId] = message.payload.eventId;
          roundsSolved.add(1);
        }
        if (isHost && nextRoundRequestedFor !== roundId) {
          nextRoundRequestedFor = roundId;
          send(socket, 'START_NEXT_ROUND', { previousRoundId: roundId });
        }
      }
    });

    if (isHost) {
      drawingTimer = socket.setInterval(() => {
        if (!playerId || currentState?.round.status !== 'DRAWING_AND_GUESSING') return;
        send(socket, 'DRAW_STROKE_BATCH', {
          roundId: currentState.round.roundId,
          drawingRevision: currentState.drawing.drawingRevision,
          drawerEpoch: currentState.drawerEpoch,
          strokeId: timedUuid(),
          batchSeq: 0,
          isFinal: true,
          tool: 'PEN',
          color: 'PURPLE',
          width: 'MEDIUM',
          points: [{ x: Math.random(), y: Math.random() }]
        });
      }, 50);
    }

    socket.setTimeout(() => {
      closedByTest = true;
      if (drawingTimer !== null) clearInterval(drawingTimer);
      socket.clearTimeouts();
      socket.close();
    }, Number(__ENV.SOCKET_DURATION_MS || 30 * 60_000 + 1_000));
    socket.on('close', () => {
      if (drawingTimer !== null) clearInterval(drawingTimer);
      socket.clearTimeouts();
      if (!closedByTest && !connectionDropped) {
        connectionDropped = true;
        normalConnectionDrops.add(1);
      }
    });
    socket.on('error', () => {
      if (!connectionDropped) {
        connectionDropped = true;
        normalConnectionDrops.add(1);
      }
    });
}
