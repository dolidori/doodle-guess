import { useState } from 'react';

export const CreateRoomForm = ({
  nickname,
  disabled,
  onCreate
}: {
  nickname: string;
  disabled: boolean;
  onCreate: (mode: 'NORMAL' | 'MODERATOR') => void;
}) => {
  const [mode, setMode] = useState<'NORMAL' | 'MODERATOR'>('NORMAL');
  return (
    <form
      className="lobby-form"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(mode);
      }}
    >
      <fieldset>
        <legend>새 방 모드</legend>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === 'NORMAL'}
            onChange={() => setMode('NORMAL')}
          />
          일반 모드
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === 'MODERATOR'}
            onChange={() => setMode('MODERATOR')}
          />
          진행자 모드
        </label>
      </fieldset>
      <button type="submit" className="primary" disabled={disabled || !nickname.trim()}>
        방 만들기
      </button>
    </form>
  );
};
