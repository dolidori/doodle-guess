import { useState } from 'react';
import {
  recentRooms,
  removeRecentRoom,
  useGame
} from '../state/GameContext.js';
import { CreateRoomForm } from '../components/lobby/CreateRoomForm.js';
import { JoinRoomForm } from '../components/lobby/JoinRoomForm.js';
import { ServerStatus } from '../components/lobby/ServerStatus.js';

export const LobbyScreen = () => {
  const { state, createRoom, joinRoom } = useGame();
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [recent, setRecent] = useState(recentRooms);
  const disabled = state.connection.status !== 'CONNECTED';

  return (
    <main className="lobby-screen">
      <section className="lobby-card">
        <div className="brand-spacer" aria-label="Doodle Guess 두들 게스" />
        <ServerStatus />
        <div className="lobby-grid">
          <div>
            <label htmlFor="nickname">닉네임</label>
            <input
              id="nickname"
              value={nickname}
              maxLength={20}
              autoComplete="nickname"
              onChange={(event) => setNickname(event.target.value)}
            />
          </div>
          <CreateRoomForm
            nickname={nickname}
            disabled={disabled}
            onCreate={(mode) => createRoom(nickname.trim(), mode)}
          />
          <JoinRoomForm
            roomCode={roomCode}
            nickname={nickname}
            disabled={disabled}
            onRoomCode={setRoomCode}
            onJoin={() => joinRoom(roomCode, nickname.trim())}
          />
        </div>
        {recent.length > 0 && (
          <section className="recent-rooms">
            <h2>최근 접속</h2>
            <ul>
              {recent.map((item) => (
                <li key={`${item.roomCode}:${item.nickname}`}>
                  <button
                    type="button"
                    className="recent-room"
                    onClick={() => {
                      setRoomCode(item.roomCode);
                      setNickname(item.nickname);
                    }}
                  >
                    방 {item.roomCode} · {item.nickname}
                  </button>
                  <button
                    type="button"
                    className="ghost compact"
                    aria-label={`방 ${item.roomCode} ${item.nickname} 최근 접속 삭제`}
                    onClick={() => {
                      removeRecentRoom(item.roomCode, item.nickname);
                      setRecent(recentRooms());
                    }}
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </main>
  );
};
