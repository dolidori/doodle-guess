// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundMusic } from './BackgroundMusic.js';

describe('배경음 재생기', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('무작위 곡으로 시작하고 종료 시 같은 곡을 연속 재생하지 않는다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { container } = render(<BackgroundMusic active volume={0.42} />);
    const audio = container.querySelector('audio')!;

    expect(audio.src).toMatch(/\/sounds\/bgm1\.mp3$/u);
    expect(audio.volume).toBe(0.42);
    fireEvent.ended(audio);
    expect(audio.src).toMatch(/\/sounds\/bgm2\.mp3$/u);
  });

  it('볼륨 0 요청은 멈추고 양수 요청은 현재 곡을 재생한다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);
    render(<BackgroundMusic active volume={0.35} />);

    window.dispatchEvent(new CustomEvent('doodle-guess-bgm-volume', { detail: 0 }));
    expect(pause).toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent('doodle-guess-bgm-volume', { detail: 0.7 }));
    expect(play).toHaveBeenCalled();
  });
});
