export const JoinRoomForm = ({
  roomCode,
  nickname,
  disabled,
  onRoomCode,
  onJoin
}: {
  roomCode: string;
  nickname: string;
  disabled: boolean;
  onRoomCode: (value: string) => void;
  onJoin: () => void;
}) => (
  <form
    className="lobby-form join-form"
    onSubmit={(event) => {
      event.preventDefault();
      onJoin();
    }}
  >
    <label htmlFor="room-code">방번호</label>
    <input
      id="room-code"
      inputMode="numeric"
      pattern="[0-9]*"
      value={roomCode}
      placeholder="100~999"
      onChange={(event) => onRoomCode(event.target.value.replace(/\D/gu, '').slice(0, 3))}
    />
    <button
      type="submit"
      className="primary"
      disabled={disabled || !/^[1-9][0-9]{2}$/u.test(roomCode) || !nickname.trim()}
    >
      입장하기
    </button>
  </form>
);
