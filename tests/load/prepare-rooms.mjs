import { randomUUID } from 'node:crypto';
import console from 'node:console';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import WebSocket from 'ws';

const roomCount = Number(process.env.ROOM_COUNT ?? 20);
const wsUrl = process.env.WS_URL ?? 'ws://127.0.0.1:3001/ws';
const outputPath = process.env.ROOM_CONFIG_PATH;

if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 50) {
  throw new Error('ROOM_COUNT는 1~50 정수여야 합니다.');
}
if (!outputPath) throw new Error('ROOM_CONFIG_PATH가 필요합니다.');

const createRoom = (roomIndex) => new Promise((resolve, reject) => {
  const socket = new WebSocket(wsUrl);
  const timeout = setTimeout(() => {
    socket.terminate();
    reject(new Error(`방 ${roomIndex} 생성 시간 초과`));
  }, 10_000);

  socket.once('open', () => {
    socket.send(JSON.stringify({
      v: 1,
      type: 'CREATE_ROOM',
      requestId: randomUUID(),
      payload: {
        nickname: `부하호스트${roomIndex}`,
        mode: 'NORMAL'
      }
    }));
  });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'ERROR') {
      clearTimeout(timeout);
      socket.terminate();
      reject(new Error(`방 ${roomIndex} 생성 실패: ${message.payload.code}`));
      return;
    }
    if (message.type !== 'ROOM_SESSION') return;
    clearTimeout(timeout);
    const room = {
      roomIndex,
      roomCode: message.payload.roomCode,
      hostNickname: message.payload.nickname,
      hostSessionToken: message.payload.sessionToken
    };
    socket.close();
    resolve(room);
  });
  socket.once('error', reject);
});

const rooms = [];
for (let index = 0; index < roomCount; index += 1) {
  rooms.push(await createRoom(index));
}

await writeFile(outputPath, `${JSON.stringify({ rooms }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ roomCount: rooms.length, outputPath }));
