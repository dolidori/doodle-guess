import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import WebSocket from 'ws';

const configPath = process.env.ROOM_CONFIG_PATH;
const reportPath = process.env.SLOW_REPORT_PATH;
const wsUrl = process.env.WS_URL ?? 'ws://127.0.0.1:3001/ws';
const durationMs = Number(process.env.DURATION_MS ?? 30 * 60_000);
const initialPauseDelayMs = Number(process.env.SLOW_PAUSE_DELAY_MS ?? 5 * 60_000);
const pauseDurationMs = Number(process.env.SLOW_PAUSE_DURATION_MS ?? 20_000);
const recoveryDurationMs = Number(process.env.SLOW_RECOVERY_DURATION_MS ?? 5_000);

if (!configPath || !reportPath) {
  throw new Error('ROOM_CONFIG_PATH와 SLOW_REPORT_PATH가 필요합니다.');
}

const { rooms } = JSON.parse(await readFile(configPath, 'utf8'));
const stats = {
  targetObservers: rooms.length,
  joined: 0,
  reconnects: 0,
  pauseCycles: 0,
  close1013: 0,
  unexpectedCloses: 0,
  errors: 0
};
const sockets = new Set();
let stopping = false;
let slowPhaseStarted = false;

setTimeout(() => {
  slowPhaseStarted = true;
}, initialPauseDelayMs);

const connect = (room, reconnect = false) => {
  if (stopping) return;
  const socket = new WebSocket(wsUrl);
  sockets.add(socket);
  let joined = false;
  let paused = false;
  let wasPaused = false;

  const schedulePause = (delay) => {
    setTimeout(() => {
      if (stopping || socket.readyState !== WebSocket.OPEN) return;
      paused = true;
      wasPaused = true;
      stats.pauseCycles += 1;
      socket._socket?.pause();
      setTimeout(() => {
        paused = false;
        socket._socket?.resume();
        if (!stopping && socket.readyState === WebSocket.OPEN) {
          schedulePause(recoveryDurationMs);
        }
      }, pauseDurationMs);
    }, delay);
  };

  socket.once('open', () => {
    socket.send(JSON.stringify({
      v: 1,
      type: 'JOIN_ROOM',
      requestId: randomUUID(),
      payload: {
        roomCode: room.roomCode,
        nickname: `느린관찰자${room.roomIndex}`
      }
    }));
  });
  socket.on('message', (raw) => {
    if (joined) return;
    const message = JSON.parse(raw.toString());
    if (message.type === 'ERROR') {
      stats.errors += 1;
      return;
    }
    if (message.type !== 'ROOM_SESSION') return;
    joined = true;
    stats.joined += 1;
    if (reconnect) stats.reconnects += 1;
    const pauseAfter = slowPhaseStarted ? 250 : initialPauseDelayMs;
    schedulePause(pauseAfter);
  });
  socket.once('close', (code) => {
    sockets.delete(socket);
    if (stopping) return;
    if (code === 1013 || paused || wasPaused) stats.close1013 += 1;
    else stats.unexpectedCloses += 1;
    setTimeout(() => connect(room, true), 100);
  });
  socket.once('error', () => {
    stats.errors += 1;
  });
};

for (const room of rooms) connect(room);

const finish = async () => {
  if (stopping) return;
  stopping = true;
  for (const socket of sockets) {
    socket._socket?.resume();
    socket.terminate();
  }
  await writeFile(reportPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ event: 'slow_observers_finished', ...stats }));
  process.exit(0);
};

setTimeout(() => void finish(), durationMs);
process.once('SIGINT', () => void finish());
process.once('SIGTERM', () => void finish());
console.log(JSON.stringify({ event: 'slow_observers_started', count: rooms.length }));
