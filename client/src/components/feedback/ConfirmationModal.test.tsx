// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmationModal } from './ConfirmationModal.js';

describe('ConfirmationModal', () => {
  it('취소에 먼저 초점을 두고 전용 확인 동작을 제공한다', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmationModal
        title="방 나가기"
        message="방을 나가시겠습니까?"
        confirmLabel="나가기"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(document.activeElement).toBe(screen.getByRole('button', { name: '취소' }));
    fireEvent.click(screen.getByRole('button', { name: '나가기' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Escape 키로 닫을 수 있다', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmationModal
        title="전체 지우기"
        message="현재 그림을 모두 지우시겠습니까?"
        confirmLabel="전체 지우기"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
