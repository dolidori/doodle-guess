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
      // 모바일에서 입력창이 포커스된 채로 누르면 첫 탭이 키보드 닫힘에 소모되어
      // 버튼이 눌리지 않는다. 포커스 이동을 막아 첫 탭에서 바로 제출되게 한다.
      onPointerDown={(event) => event.preventDefault()}
      disabled={disabled || !/^[1-9][0-9]{2}$/u.test(roomCode) || !nickname.trim()}
    >
      입장하기
    </button>
  </form>
);
