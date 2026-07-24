import { expect, test } from '@playwright/test';

test('일반 모드 생성부터 그림, 정답, 잠금, 다음 라운드까지 진행된다', async ({ browser }) => {
  const context = await browser.newContext();
  const host = await context.newPage();
  const guest = await context.newPage();

  await host.goto('/');
  await host.getByLabel('닉네임').fill('방장');
  await host.getByRole('button', { name: '방 만들기' }).click();
  const roomButton = host.getByRole('button', { name: /방번호 \d{3} 크게 보기/ });
  await expect(roomButton).toBeVisible();
  const roomCode = (await roomButton.textContent())!.replace(/\D/gu, '');
  host.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe(`방번호 ${roomCode}`);
    await dialog.accept();
  });
  await roomButton.click();

  await guest.goto('/');
  await guest.getByLabel('닉네임').fill('참가자');
  await guest.getByLabel('방번호').fill(`a${roomCode}b`);
  await expect(guest.getByLabel('방번호')).toHaveValue(roomCode);
  await guest.getByLabel('방번호').fill(roomCode);
  await guest.getByLabel('방번호').press('Enter');
  await expect(guest.locator('.identity strong')).toHaveText('참가자');

  await host.getByLabel('제시어', { exact: true }).fill('보라색');
  await host.getByRole('button', { name: '제시어 확정 및 시작' }).click();
  await expect(host.getByText('제시어가 가려졌습니다.')).toBeVisible();
  await expect(guest.getByLabel('정답 추측')).toBeEnabled();

  const canvas = host.locator('.canvas-stage');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await host.mouse.move(box!.x + 40, box!.y + 40);
  await host.mouse.down();
  await host.mouse.move(box!.x + 140, box!.y + 110, { steps: 8 });
  await host.mouse.up();
  await expect(guest.locator('.canvas-stage canvas').first()).toBeVisible();

  await guest.getByLabel('정답 추측').fill('보 라 색');
  await guest.getByRole('button', { name: '제출' }).click();
  await expect(host.getByRole('dialog')).toContainText('참가자님이 가장 먼저 맞혔습니다.');
  await host.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await expect(guest.getByRole('dialog')).toContainText('참가자님이 가장 먼저 맞혔습니다.');
  await guest.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await expect(host.getByText('정답 확정 · 참가자')).toBeVisible();
  await expect(guest.getByLabel('정답 추측')).toBeDisabled();

  host.once('dialog', (dialog) => dialog.accept());
  await host.getByRole('button', { name: '대기실로 돌아가기' }).click();
  await expect(host.getByRole('button', { name: '제시어 확정 및 시작' })).toBeVisible();

  guest.once('dialog', (dialog) => dialog.accept());
  await guest.getByRole('button', { name: '나가기' }).click();
  await expect(guest.getByRole('button', { name: '방 만들기' })).toBeVisible();
  await expect(guest.getByRole('button', { name: `방 ${roomCode} · 참가자` })).toBeVisible();
  await guest.getByRole('button', {
    name: `방 ${roomCode} 참가자 최근 접속 삭제`
  }).click();
  await expect(guest.getByRole('button', { name: `방 ${roomCode} · 참가자` })).toHaveCount(0);
  await context.close();
});

test('PWA manifest와 핵심 아이콘을 제공한다', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const body = await manifest.json();
  expect(body.name).toBe('Doodle Guess');
  expect(body.lang).toBe('ko');
  expect(body.display).toBe('standalone');
  expect(body.orientation).toBe('any');
  for (const icon of [
    '/images/icon/icon-192.png',
    '/images/icon/icon-512.png',
    '/images/icon/icon-512-maskable.png',
    '/images/icon/apple-touch-icon.png'
  ]) {
    expect((await request.get(icon)).ok()).toBe(true);
  }
});
