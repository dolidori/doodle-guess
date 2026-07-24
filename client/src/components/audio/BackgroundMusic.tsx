import { useEffect, useRef, useState } from 'react';

const TRACKS = [
  '/sounds/bgm1.mp3',
  '/sounds/bgm2.mp3',
  '/sounds/bgm3.mp3',
  '/sounds/bgm4.mp3',
  '/sounds/bgm5.mp3'
] as const;

const randomTrackAfter = (current: number): number => {
  const candidate = Math.floor(Math.random() * (TRACKS.length - 1));
  return candidate >= current ? candidate + 1 : candidate;
};

export const BackgroundMusic = ({
  active,
  volume
}: {
  active: boolean;
  volume: number;
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeRef = useRef(active);
  const [trackIndex, setTrackIndex] = useState(
    () => Math.floor(Math.random() * TRACKS.length)
  );

  useEffect(() => {
    activeRef.current = active;
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    if (!active) {
      audio.pause();
      return;
    }
    void audio.play().catch(() => {
      // 브라우저 자동재생 제한 시 다음 사용자 입력에서 다시 시도한다.
    });
  }, [active, trackIndex, volume]);

  useEffect(() => {
    const resume = (): void => {
      const audio = audioRef.current;
      if (!activeRef.current || !audio?.paused) return;
      void audio.play().catch(() => undefined);
    };
    const setVolume = (event: Event): void => {
      const nextVolume = (event as CustomEvent<number>).detail;
      const audio = audioRef.current;
      if (!audio) return;
      audio.volume = nextVolume;
      activeRef.current = nextVolume > 0;
      if (nextVolume > 0) {
        void audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
    };
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
    window.addEventListener('doodle-guess-bgm-volume', setVolume);
    return () => {
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
      window.removeEventListener('doodle-guess-bgm-volume', setVolume);
    };
  }, []);

  return (
    <audio
      ref={audioRef}
      src={TRACKS[trackIndex]}
      preload="metadata"
      onEnded={() => setTrackIndex(randomTrackAfter)}
    />
  );
};
