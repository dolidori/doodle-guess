// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DrawingToolbar } from './DrawingToolbar.js';

describe('DrawingToolbar', () => {
  it('아이콘형 도구와 점 굵기 버튼을 제공한다', () => {
    const onChange = vi.fn();
    render(
      <DrawingToolbar
        settings={{ tool: 'PEN', color: 'BLACK', width: 'MEDIUM' }}
        onChange={onChange}
        disabled={false}
        canUndo
        onUndo={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '펜' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '지우개' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '얇은 굵기' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '보통 굵기' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: '굵은 굵기' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '되돌리기' })).toHaveTextContent('↩');

    fireEvent.click(screen.getByRole('button', { name: '지우개' }));
    expect(onChange).toHaveBeenCalledWith({
      tool: 'ERASER',
      color: 'BLACK',
      width: 'MEDIUM'
    });
  });
});
