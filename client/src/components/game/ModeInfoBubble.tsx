import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * 설정 패널의 물음표(?) 설명 말풍선.
 * 설정 패널은 내용이 넘치면 스크롤되도록 overflow 가 걸려 있어, 패널 밖(캔버스 쪽)으로 나가는 말풍선이 잘려
 * 보이지 않았다. 화면 맨 위층(body)에 띄우고 물음표 버튼 바로 위에 놓는다 — 위 공간이 모자라면 아래에.
 * 버튼은 열려 있는 동안 aria-describedby 로 이 말풍선 id 를 가리킨다(그걸로 버튼 위치를 찾는다).
 */
export const ModeInfoBubble = ({ id, children }: { id: string; children: ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; arrow: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    const update = (): void => {
      const trigger = document.querySelector<HTMLElement>(`[aria-describedby="${id}"]`);
      const bubble = ref.current;
      if (!trigger || !bubble) return;
      const anchor = trigger.getBoundingClientRect();
      const size = bubble.getBoundingClientRect();
      const gap = 10;
      const margin = 8;
      const left = Math.min(Math.max(margin, anchor.left), window.innerWidth - size.width - margin);
      const above = anchor.top - gap - size.height;
      const below = above < margin;
      setPlace({
        left,
        top: below ? anchor.bottom + gap : above,
        // 꼬리는 버튼 글자 앞쪽을 가리킨다(말풍선이 화면 안으로 밀려도 버튼을 가리키게)
        arrow: Math.min(Math.max(12, anchor.left + 16 - left), size.width - 24),
        below
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [id]);

  const style: CSSProperties = place
    ? ({ left: place.left, top: place.top, '--arrow-left': `${place.arrow}px` } as CSSProperties)
    : { left: 0, top: 0, visibility: 'hidden' };

  return createPortal(
    <div
      ref={ref}
      id={id}
      className={`mode-info-bubble floating${place?.below ? ' below' : ''}`}
      role="tooltip"
      style={style}
    >
      {children}
    </div>,
    document.body
  );
};
