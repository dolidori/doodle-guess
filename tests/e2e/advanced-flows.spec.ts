import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const openPlayer = async (browser: Browser): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  return { context, page };
};

const createRoom = async (
  page: Page,
  nickname: string,
  mode: 'NORMAL' | 'MODERATOR' = 'NORMAL'
): Promise<string> => {
  await page.getByLabel('닉네임').fill(nickname);
  if (mode === 'MODERATOR') await page.getByLabel('진행자 모드').check();
  await page.getByRole('button', { name: '방 만들기' }).click();
  const roomButton = page.getByRole('button', { name: /방번호 \d{3} 크게 보기/ });
  await expect(roomButton).toBeVisible();
  return (await roomButton.textContent())!.replace(/\D/gu, '');
};

const joinRoom = async (
  page: Page,
  roomCode: string,
  nickname: string
): Promise<void> => {
  await page.getByLabel('닉네임').fill(nickname);
  await page.getByLabel('방번호').fill(roomCode);
  await page.getByRole('button', { name: '입장하기' }).click();
  await expect(page.locator('.identity strong')).toHaveText(nickname);
};

const drawLine = async (page: Page): Promise<void> => {
  const canvas = page.locator('.canvas-stage');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 30, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 150, box!.y + 100, { steps: 10 });
  await page.mouse.up();
};

const hasPaintedPixel = async (page: Page): Promise<boolean> =>
  page.locator('.canvas-stage canvas').first().evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (!context || canvas.width === 0 || canvas.height === 0) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index]! > 0) return true;
    }
    return false;
  });

test('진행자 모드에서 drawer 지정·회수·재지정과 제시어 경계를 지킨다', async ({ browser }) => {
  const moderator = await openPlayer(browser);
  const drawer = await openPlayer(browser);
  const nextDrawer = await openPlayer(browser);
  const roomCode = await createRoom(moderator.page, '진행자', 'MODERATOR');
  await joinRoom(drawer.page, roomCode, '첫화가');
  await joinRoom(nextDrawer.page, roomCode, '다음화가');

  const firstRow = moderator.page.locator('.player-panel li').filter({ hasText: '첫화가' });
  await firstRow.getByRole('button', { name: '그리기 권한 주기' }).click();
  await expect(drawer.page.getByRole('button', { name: '제시어 확정 및 시작' })).toBeVisible();

  await drawer.page.getByLabel('제시어', { exact: true }).fill('비밀 단어');
  await drawer.page.getByRole('button', { name: '제시어 확정 및 시작' }).click();
  await expect(drawer.page.locator('.canvas-stage')).toHaveClass(/enabled/);
  await expect(nextDrawer.page.getByLabel('정답 추측')).toBeEnabled();
  await expect(nextDrawer.page.locator('body')).not.toContainText('비밀 단어');

  await moderator.page.getByRole('button', { name: '그리기 권한 가져오기' }).click();
  await expect(moderator.page.locator('.canvas-stage')).toHaveClass(/enabled/);
  await expect(drawer.page.getByLabel('정답 추측')).toBeDisabled();
  await expect(drawer.page.locator('body')).not.toContainText('비밀 단어');

  const nextRow = moderator.page.locator('.player-panel li').filter({ hasText: '다음화가' });
  await nextRow.getByRole('button', { name: '그리기 권한 주기' }).click();
  await expect(nextDrawer.page.locator('.canvas-stage')).toHaveClass(/enabled/);
  await expect(nextDrawer.page.getByRole('button', { name: '제시어 보기' })).toBeVisible();

  await Promise.all([
    moderator.context.close(),
    drawer.context.close(),
    nextDrawer.context.close()
  ]);
});

test('20초 deadline 만료 후 그림·추측을 잠그고 다음 라운드로 진행한다', async ({ browser }) => {
  test.setTimeout(40_000);
  const host = await openPlayer(browser);
  const guest = await openPlayer(browser);
  const roomCode = await createRoom(host.page, '시간호스트');
  await joinRoom(guest.page, roomCode, '시간참가자');
  await host.page.evaluate(() => {
    (window as any).__warningCount = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.textContent?.includes('10초 남았습니다.')) {
            (window as any).__warningCount += 1;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  const slider = host.page.getByLabel('제한 시간');
  await slider.focus();
  await slider.press('Home');
  await slider.press('Tab');
  await expect(host.page.locator('.duration-panel output')).toHaveText('20초');
  await host.page.getByLabel('제시어', { exact: true }).fill('만료');
  await host.page.getByRole('button', { name: '제시어 확정 및 시작' }).click();

  await expect(host.page.getByRole('dialog')).toContainText('이번 라운드에는 정답자가 없습니다.', {
    timeout: 25_000
  });
  await expect(host.page.getByRole('dialog').getByRole('button', { name: '확인' })).toBeFocused();
  await host.page.keyboard.press('Tab');
  await expect(host.page.getByRole('dialog').getByRole('button', { name: '확인' })).toBeFocused();
  await host.page.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await guest.page.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await expect(guest.page.getByLabel('정답 추측')).toBeDisabled();
  await expect(host.page.locator('.canvas-stage')).toHaveClass(/locked/);
  expect(await host.page.evaluate(() => (window as any).__warningCount)).toBe(1);

  await host.page.getByRole('button', { name: '대기실로 돌아가기' }).click();
  await host.page.getByRole('dialog', { name: '대기실로 돌아가기' })
    .getByRole('button', { name: '대기실로 돌아가기' }).click();
  await expect(host.page.getByRole('button', { name: '제시어 확정 및 시작' })).toBeVisible();
  await Promise.all([host.context.close(), guest.context.close()]);
});

test('강퇴된 사용자는 안내를 받고 token과 nickname으로 재입장할 수 없다', async ({ browser }) => {
  const host = await openPlayer(browser);
  const guest = await openPlayer(browser);
  const roomCode = await createRoom(host.page, '강퇴호스트');
  await joinRoom(guest.page, roomCode, '강퇴대상');

  const guestRow = host.page.locator('.player-panel li').filter({ hasText: '강퇴대상' });
  await guestRow.getByRole('button', { name: '내보내기' }).click();
  await expect(guest.page.getByRole('alertdialog')).toContainText('방에서 내보내졌습니다');
  await expect(host.page.locator('.toast')).toContainText('강퇴대상님이 방에서 나갔습니다.');

  await guest.page.getByRole('button', { name: '로비로 돌아가기' }).click();
  await guest.page.getByLabel('닉네임').fill('강퇴대상');
  await guest.page.getByLabel('방번호').fill(roomCode);
  await guest.page.getByRole('button', { name: '입장하기' }).click();
  await expect(guest.page.locator('.toast')).toContainText('강퇴된 닉네임입니다.');
  await expect(guest.page.getByRole('button', { name: '방 만들기' })).toBeVisible();
  await Promise.all([host.context.close(), guest.context.close()]);
});

test('호스트 연결이 끊겨도 이양하지 않고 원래 nickname으로 복구하며 명시 퇴장 시 닫는다', async ({ browser }) => {
  const host = await openPlayer(browser);
  const guest = await openPlayer(browser);
  const roomCode = await createRoom(host.page, '원래호스트');
  await joinRoom(guest.page, roomCode, '일반참가자');

  await host.page.close();
  const hostRow = guest.page.locator('.player-panel li').filter({ hasText: '원래호스트' });
  await expect(hostRow).toContainText('연결 끊김');
  await expect(hostRow).toContainText('호스트');
  await expect(guest.page.locator('.identity')).not.toContainText('호스트');
  await expect(guest.page.locator('.warning-banner')).toContainText('방 종료까지');

  const recovered = await openPlayer(browser);
  await joinRoom(recovered.page, roomCode, '원래호스트');
  await expect(recovered.page.locator('.identity')).toContainText('호스트');
  await expect(guest.page.locator('.warning-banner')).toHaveCount(0);

  await recovered.page.getByRole('button', { name: '나가기' }).click();
  await recovered.page.getByRole('dialog', { name: '방 나가기' })
    .getByRole('button', { name: '나가기' }).click();
  await expect(guest.page.getByRole('alertdialog')).toContainText('호스트가 나가 방이 종료되었습니다.');
  await Promise.all([
    host.context.close(),
    guest.context.close(),
    recovered.context.close()
  ]);
});

test('새로고침 재연결 뒤 같은 세션·호스트 권한·그림 snapshot을 복원한다', async ({ browser }) => {
  const host = await openPlayer(browser);
  const guest = await openPlayer(browser);
  const roomCode = await createRoom(host.page, '복구호스트');
  await joinRoom(guest.page, roomCode, '복구참가자');
  await host.page.getByLabel('제시어', { exact: true }).fill('복구그림');
  await host.page.getByRole('button', { name: '제시어 확정 및 시작' }).click();
  await drawLine(host.page);
  await expect.poll(() => hasPaintedPixel(guest.page)).toBe(true);

  await host.page.reload();
  await expect(host.page.locator('.connection-chip')).toHaveText('연결됨', { timeout: 10_000 });
  await expect(host.page.locator('.identity')).toContainText('호스트');
  await expect(guest.page.locator('.player-panel li').filter({ hasText: '복구호스트' }))
    .toContainText('호스트');
  await expect.poll(() => hasPaintedPixel(host.page)).toBe(true);

  await guest.page.reload();
  await expect(guest.page.locator('.connection-chip')).toHaveText('연결됨', { timeout: 10_000 });
  await expect.poll(() => hasPaintedPixel(guest.page)).toBe(true);
  await expect(guest.page.getByLabel('정답 추측')).toBeEnabled();

  await Promise.all([host.context.close(), guest.context.close()]);
});

test('서로 다른 두 방의 그림과 추측이 브라우저에서도 교차하지 않는다', async ({ browser }) => {
  const hostA = await openPlayer(browser);
  const guestA = await openPlayer(browser);
  const hostB = await openPlayer(browser);
  const guestB = await openPlayer(browser);
  const roomA = await createRoom(hostA.page, '가호스트');
  const roomB = await createRoom(hostB.page, '나호스트');
  await joinRoom(guestA.page, roomA, '가참가자');
  await joinRoom(guestB.page, roomB, '나참가자');

  await hostA.page.getByLabel('제시어', { exact: true }).fill('가정답');
  await hostA.page.getByRole('button', { name: '제시어 확정 및 시작' }).click();
  await hostB.page.getByLabel('제시어', { exact: true }).fill('나정답');
  await hostB.page.getByRole('button', { name: '제시어 확정 및 시작' }).click();

  await drawLine(hostA.page);
  await expect.poll(() => hasPaintedPixel(guestA.page)).toBe(true);
  await expect.poll(() => hasPaintedPixel(guestB.page)).toBe(false);

  await guestA.page.getByLabel('정답 추측').fill('가방에만 보이는 오답');
  await guestA.page.getByRole('button', { name: '제출' }).click();
  await expect(hostA.page.locator('.guess-feed')).toContainText('가방에만 보이는 오답');
  await expect(hostB.page.locator('.guess-feed')).not.toContainText('가방에만 보이는 오답');
  await expect(guestB.page.locator('.guess-feed')).not.toContainText('가방에만 보이는 오답');

  await Promise.all([
    hostA.context.close(),
    guestA.context.close(),
    hostB.context.close(),
    guestB.context.close()
  ]);
});
