import { expect, test } from '@playwright/test';

test('모바일에서 공개 추측 채팅이 캔버스 오른쪽에 나란히 배치된다', async ({
  page
}, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith('chromium-mobile') &&
    !testInfo.project.name.startsWith('chromium-tablet'),
    '모바일·태블릿 전용 레이아웃 검증'
  );

  await page.goto('/');
  if ((page.viewportSize()?.width ?? 0) <= 640) {
    const lobbyCard = await page.locator('.lobby-card').boundingBox();
    const viewport = page.viewportSize()!;
    expect(lobbyCard).not.toBeNull();
    expect(Math.abs(
      lobbyCard!.y + lobbyCard!.height / 2 - viewport.height / 2
    )).toBeLessThanOrEqual(viewport.height * 0.08);
  }
  await page.getByLabel('닉네임').fill('모바일방장');
  await page.getByRole('button', { name: '방 만들기' }).click();

  const canvasBox = await page.locator('.canvas-stage').boundingBox();
  const feedBox = await page.locator('.guess-feed:visible').boundingBox();

  expect(canvasBox).not.toBeNull();
  expect(feedBox).not.toBeNull();
  expect(feedBox!.x).toBeGreaterThanOrEqual(canvasBox!.x + canvasBox!.width - 1);
  expect(Math.abs(feedBox!.y - canvasBox!.y)).toBeLessThanOrEqual(2);

  if ((page.viewportSize()?.width ?? 0) <= 640) {
    const canvasAndChat = page.locator('.canvas-and-chat');
    const chatList = page.locator('.side-guess-feed ol');
    const initialRowBox = await canvasAndChat.boundingBox();
    await chatList.evaluate((list) => {
      for (let index = 0; index < 40; index += 1) {
        const item = document.createElement('li');
        item.textContent = `긴 채팅 메시지 ${index}`;
        list.append(item);
      }
    });
    const expandedRowBox = await canvasAndChat.boundingBox();
    const chatScroll = await chatList.evaluate((list) => ({
      clientHeight: list.clientHeight,
      scrollHeight: list.scrollHeight,
      overflowY: getComputedStyle(list).overflowY
    }));

    expect(initialRowBox).not.toBeNull();
    expect(expandedRowBox).not.toBeNull();
    expect(Math.abs(expandedRowBox!.height - initialRowBox!.height)).toBeLessThanOrEqual(1);
    expect(chatScroll.overflowY).toBe('auto');
    expect(chatScroll.scrollHeight).toBeGreaterThan(chatScroll.clientHeight);

    const canvasColumnBox = await page.locator('.canvas-column').boundingBox();
    const playerPanelBox = await page.locator('.player-panel').boundingBox();
    const controlColumnBox = await page.locator('.control-column').boundingBox();

    expect(canvasColumnBox).not.toBeNull();
    expect(playerPanelBox).not.toBeNull();
    expect(controlColumnBox).not.toBeNull();
    expect(playerPanelBox!.y).toBeGreaterThanOrEqual(
      canvasColumnBox!.y + canvasColumnBox!.height - 1
    );
    expect(controlColumnBox!.y).toBeGreaterThanOrEqual(
      playerPanelBox!.y + playerPanelBox!.height - 1
    );
  } else {
    const layoutBottomPadding = await page.locator('.room-layout').evaluate(
      (layout) => Number.parseFloat(getComputedStyle(layout).paddingBottom)
    );
    const canvasColumnBox = await page.locator('.canvas-column').boundingBox();
    const controlColumnBox = await page.locator('.control-column').boundingBox();

    expect(layoutBottomPadding).toBeGreaterThanOrEqual(24);
    expect(canvasColumnBox).not.toBeNull();
    expect(controlColumnBox).not.toBeNull();
    const viewport = page.viewportSize()!;
    if (viewport.width > viewport.height && viewport.height <= 500) {
      expect(controlColumnBox!.x).toBeGreaterThanOrEqual(
        canvasColumnBox!.x + canvasColumnBox!.width - 1
      );
    } else {
      expect(controlColumnBox!.y).toBeGreaterThanOrEqual(
        canvasColumnBox!.y + canvasColumnBox!.height - 1
      );
    }
  }
});

test('일반 모드 생성부터 그림, 정답, 잠금, 다음 라운드까지 진행된다', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/');
  await host.getByLabel('닉네임').fill('방장');
  await host.getByRole('button', { name: '방 만들기' }).click();
  if ((host.viewportSize()?.width ?? 0) >= 1024) {
    const desktopCanvas = await host.locator('.canvas-stage').boundingBox();
    const desktopFeed = await host.locator('.side-guess-feed').boundingBox();
    const desktopControls = await host.locator('.control-column').boundingBox();
    const desktopCanvasColumn = await host.locator('.canvas-column').boundingBox();

    expect(desktopCanvas).not.toBeNull();
    expect(desktopFeed).not.toBeNull();
    expect(desktopControls).not.toBeNull();
    expect(desktopCanvasColumn).not.toBeNull();
    expect(desktopFeed!.x).toBeGreaterThanOrEqual(
      desktopCanvas!.x + desktopCanvas!.width - 1
    );
    expect(desktopControls!.y).toBeGreaterThanOrEqual(
      desktopCanvasColumn!.y + desktopCanvasColumn!.height - 1
    );
  }
  const roomButton = host.getByRole('button', { name: /방번호 \d{3} 크게 보기/ });
  await expect(roomButton).toBeVisible();
  const header = host.locator('.game-header');
  const headerTitle = host.getByRole('img', { name: 'Doodle Guess' });
  await expect(headerTitle).toBeVisible();
  if ((host.viewportSize()?.width ?? 0) >= 1024) {
    const headerBox = await header.boundingBox();
    const titleBox = await headerTitle.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(titleBox!.width).toBeGreaterThanOrEqual(224);
    expect(Math.abs(
      titleBox!.x + titleBox!.width / 2 - (headerBox!.x + headerBox!.width / 2)
    )).toBeLessThanOrEqual(2);
  }
  const roomCode = (await roomButton.textContent())!.replace(/\D/gu, '');
  await roomButton.click();
  const roomCodeDialog = host.getByRole('dialog', { name: '방번호' });
  await expect(roomCodeDialog).toContainText(roomCode);
  await roomCodeDialog.getByRole('button', { name: '닫기' }).click();
  await expect(roomCodeDialog).toBeHidden();
  await expect(roomButton).toBeFocused();

  await guest.goto('/');
  await guest.getByLabel('닉네임').fill('참가자');
  await guest.getByLabel('방번호').fill(`a${roomCode}b`);
  await expect(guest.getByLabel('방번호')).toHaveValue(roomCode);
  await guest.getByLabel('방번호').fill(roomCode);
  await guest.getByRole('button', { name: '입장하기' }).click();
  await expect(guest.locator('.identity strong')).toHaveText('참가자');

  const drawerModePanel = host.locator('.drawer-order-panel');
  const answerModePanel = host.locator('.answer-mode-panel');
  const drawerModeBox = await drawerModePanel.boundingBox();
  const answerModeBox = await answerModePanel.boundingBox();
  expect(drawerModeBox).not.toBeNull();
  expect(answerModeBox).not.toBeNull();
  expect(Math.abs(drawerModeBox!.height - answerModeBox!.height)).toBeLessThanOrEqual(1);

  await host.getByRole('button', { name: '그리기 순서' }).click();
  await expect(host.getByRole('tooltip')).toContainText('정한 바퀴 수만큼');
  await host.getByRole('button', { name: '그리기 순서' }).click();
  await expect(host.getByRole('tooltip')).toBeHidden();
  await host.getByRole('button', { name: '정답 판정 모드' }).click();
  await expect(host.getByRole('tooltip')).toContainText('첫 정답에서 끝납니다');
  await host.locator('.canvas-stage').click({ position: { x: 10, y: 10 } });
  await expect(host.getByRole('tooltip')).toBeHidden();

  await host.getByLabel('선착순 종료').click();
  await expect(host.getByLabel('선착순 종료')).toBeChecked();
  await host.getByLabel('제시어', { exact: true }).fill('보라색');
  await host.getByRole('button', { name: '제시어 확정 및 시작' }).click();
  await expect(host.getByText('제시어가 가려졌습니다.')).toBeVisible();
  await expect(guest.getByLabel('정답 추측')).toBeEnabled();
  const submitButtonStyle = await guest.getByRole('button', { name: '제출' }).evaluate(
    (button) => ({
      flexBasis: Number.parseFloat(getComputedStyle(button).flexBasis),
      minWidth: Number.parseFloat(getComputedStyle(button).minWidth),
      whiteSpace: getComputedStyle(button).whiteSpace,
      wordBreak: getComputedStyle(button).wordBreak
    })
  );
  expect(submitButtonStyle.whiteSpace).toBe('nowrap');
  expect(submitButtonStyle.wordBreak).toBe('keep-all');
  expect(submitButtonStyle.flexBasis).toBeGreaterThanOrEqual(112);
  expect(submitButtonStyle.minWidth).toBeGreaterThanOrEqual(112);

  const canvas = host.locator('.canvas-stage');
  await host.getByRole('button', { name: '지우개' }).click();
  await canvas.scrollIntoViewIfNeeded();
  let box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (await host.evaluate(() => matchMedia('(hover: hover)').matches)) {
    await host.mouse.move(box!.x + 80, box!.y + 80);
    const eraserCursor = host.locator('.eraser-cursor');
    await expect(eraserCursor).toBeVisible();
    const cursorBox = await eraserCursor.boundingBox();
    expect(cursorBox!.width).toBeCloseTo(Math.min(box!.width, box!.height) * 0.014 * 4, 0);
  }

  await host.getByRole('button', { name: '펜' }).click();
  await canvas.scrollIntoViewIfNeeded();
  box = await canvas.boundingBox();
  await host.mouse.move(box!.x + 40, box!.y + 40);
  await host.mouse.down();
  await host.mouse.move(box!.x + 140, box!.y + 110, { steps: 8 });
  await host.mouse.up();
  const undoButton = host.getByRole('button', { name: '되돌리기' });
  await expect(undoButton).toBeEnabled();
  await undoButton.click();
  await expect(undoButton).toBeDisabled();
  await expect(guest.locator('.canvas-stage canvas').first()).toBeVisible();

  await guest.getByLabel('정답 추측').fill('보 라 색');
  await guest.getByRole('button', { name: '제출' }).click();
  await expect(host.getByRole('dialog')).toContainText('참가자님이 가장 먼저 맞혔습니다.');
  await host.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await expect(guest.getByRole('dialog')).toContainText('참가자님이 가장 먼저 맞혔습니다.');
  await guest.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await expect(host.getByText('정답 확정 · 참가자')).toBeVisible();
  await expect(guest.getByLabel('정답 추측')).toBeDisabled();

  await host.getByRole('button', { name: '대기실로 돌아가기' }).click();
  await host.getByRole('dialog', { name: '대기실로 돌아가기' })
    .getByRole('button', { name: '대기실로 돌아가기' }).click();
  await expect(host.getByRole('button', { name: '제시어 확정 및 시작' })).toBeVisible();

  await guest.getByRole('button', { name: '나가기' }).click();
  await guest.getByRole('dialog', { name: '방 나가기' })
    .getByRole('button', { name: '나가기' }).click();
  await expect(guest.getByRole('button', { name: '방 만들기' })).toBeVisible();
  await expect(guest.getByRole('button', { name: `방 ${roomCode} · 참가자` })).toBeVisible();
  await guest.getByRole('button', {
    name: `방 ${roomCode} 참가자 최근 접속 삭제`
  }).click();
  await expect(guest.getByRole('button', { name: `방 ${roomCode} · 참가자` })).toHaveCount(0);
  await Promise.all([hostContext.close(), guestContext.close()]);
});

test('순서대로 한 바퀴가 끝나면 시상식 후 점수를 초기화하고 대기실로 돌아간다', async ({
  browser
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '데스크톱에서 순환 게임 전체 흐름 검증');

  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/');
  await host.getByLabel('닉네임').fill('순환방장');
  await host.getByRole('button', { name: '방 만들기' }).click();
  const roomButton = host.getByRole('button', { name: /방번호 \d{3} 크게 보기/ });
  const roomCode = (await roomButton.textContent())!.replace(/\D/gu, '');

  await guest.goto('/');
  await guest.getByLabel('닉네임').fill('순환참가자');
  await guest.getByLabel('방번호').fill(roomCode);
  await guest.getByRole('button', { name: '입장하기' }).click();

  await host.getByLabel('순서대로').click();
  await expect(host.getByLabel('순서대로')).toBeChecked();
  await expect(host.getByLabel('바퀴 수')).toHaveValue('1');
  const rotatedModePanels = await host.locator('.mode-panel').evaluateAll((panels) =>
    panels.map((panel) => ({
      clientHeight: panel.clientHeight,
      scrollHeight: panel.scrollHeight
    }))
  );
  expect(rotatedModePanels[0]!.clientHeight).toBe(rotatedModePanels[1]!.clientHeight);
  expect(rotatedModePanels[0]!.scrollHeight).toBeLessThanOrEqual(
    rotatedModePanels[0]!.clientHeight + 1
  );
  await host.getByLabel('제시어', { exact: true }).fill('첫 제시어');
  await host.getByRole('button', { name: '제시어 확정 및 시작' }).click();
  await guest.getByLabel('정답 추측').fill('첫 제시어');
  await guest.getByRole('button', { name: '제출' }).click();

  await host.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await guest.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await expect(guest.getByRole('button', { name: '제시어 확정 및 시작' })).toBeVisible();

  await guest.getByLabel('제시어', { exact: true }).fill('둘째 제시어');
  await guest.getByRole('button', { name: '제시어 확정 및 시작' }).click();
  await host.getByLabel('정답 추측').fill('둘째 제시어');
  await host.getByRole('button', { name: '제출' }).click();

  await host.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await guest.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  const ceremony = host.getByRole('dialog', { name: '최종 시상식' });
  await expect(ceremony).toContainText('순환방장');
  await expect(ceremony).toContainText('순환참가자');
  await ceremony.getByRole('button', { name: '시상식 종료 · 대기실로' }).click();

  await expect(host.getByText('0점 · 연결됨')).toHaveCount(2);
  await expect(host.getByRole('button', { name: '제시어 확정 및 시작' })).toBeVisible();
  await expect(guest.getByRole('dialog', { name: '최종 시상식' })).toBeHidden();

  await Promise.all([hostContext.close(), guestContext.close()]);
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
