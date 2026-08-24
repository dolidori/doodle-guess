import { useState } from 'react';
import { useGame } from '../../state/GameContext.js';

/**
 * AI 참여자를 쓰려면 로비에서 먼저 비밀번호를 통과해야 한다. 권한은 지금 연결에
 * 붙으므로, 로그인한 사람만 자기가 들어간 방에 AI를 넣을 수 있다.
 */
export const AiLoginForm = ({ disabled }: { disabled: boolean }) => {
  const { state, send } = useGame();
  const [password, setPassword] = useState('');
  const [open, setOpen] = useState(false);
  const authorized = state.ai?.authorized ?? false;

  // 이 서버에 AI가 설정되어 있지 않다고 이미 알려 준 경우엔 입구를 아예 감춘다.
  if (state.ai && !state.ai.available) return null;

  if (authorized) {
    return (
      <p className="ai-login-status" role="status">
        AI 참여자 사용 권한이 확인되었습니다. 방에 들어가면 추가할 수 있습니다.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="ghost compact ai-login-toggle" onClick={() => setOpen(true)}>
        AI 참여자 사용하기
      </button>
    );
  }

  return (
    <form
      className="lobby-form ai-login-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!password) return;
        send('AI_LOGIN', { password });
        setPassword('');
      }}
    >
      <label htmlFor="ai-password">AI 비밀번호</label>
      <input
        id="ai-password"
        type="password"
        value={password}
        maxLength={200}
        autoComplete="current-password"
        onChange={(event) => setPassword(event.target.value)}
      />
      <button
        type="submit"
        className="secondary"
        onPointerDown={(event) => event.preventDefault()}
        disabled={disabled || !password}
      >
        확인
      </button>
    </form>
  );
};
