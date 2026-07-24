import { ModalQueue } from '../components/feedback/ModalQueue.js';
import { ReconnectOverlay } from '../components/feedback/ReconnectOverlay.js';
import { ToastQueue } from '../components/feedback/ToastQueue.js';
import { GameScreen } from '../screens/GameScreen.js';
import { LobbyScreen } from '../screens/LobbyScreen.js';
import { useGame } from '../state/GameContext.js';

export const App = () => {
  const { state } = useGame();
  const [bgmVolume, setBgmVolume] = useState(() => {
    const storedValue = localStorage.getItem('doodle-guess-bgm-volume');
    const stored = storedValue === null ? Number.NaN : Number(storedValue);
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) return stored;
    return localStorage.getItem('doodle-guess-bgm-enabled') === 'false' ? 0 : 0.35;
  });
  const isHost = state.publicState?.players.some(
    (player) => player.playerId === state.session?.playerId && player.isHost
  ) ?? false;
  const changeBgmVolume = (volume: number): void => {
    setBgmVolume(volume);
    localStorage.setItem('doodle-guess-bgm-volume', String(volume));
    window.dispatchEvent(new CustomEvent('doodle-guess-bgm-volume', { detail: volume }));
  };
  return (
    <div className="app">
      {state.screen === 'ROOM'
        ? <GameScreen bgmVolume={bgmVolume} onBgmVolumeChange={changeBgmVolume} />
        : <LobbyScreen />}
      <BackgroundMusic
        active={state.screen === 'ROOM' && isHost && bgmVolume > 0}
        volume={bgmVolume}
      />
      <ToastQueue />
      <ModalQueue />
      <ReconnectOverlay />
    </div>
  );
};
import { useState } from 'react';
import { BackgroundMusic } from '../components/audio/BackgroundMusic.js';
