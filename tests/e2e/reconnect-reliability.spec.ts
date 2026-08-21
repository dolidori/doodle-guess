import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * 대표님 보고 증상 재현:
 *  - 중간에 튕겨져 나가는 사람이 발생한다.
 *  - 어떤 사람에게는 다른 사람의 점수가 0점으로 보인다.
 *
 * 실제 원인은 연결이 잠깐 끊긴 뒤의 복귀 실패였다. 브라우저에서 같은 흐름을 만든다.
 */

const joinRoom = async (page: Page, roomCode: string, nickname: string): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('닉네임').fill(nickname);
  await page.getByLabel('방번호').fill(roomCode);
  await page.getByRole('button', { name: '입장하기' }).click();
  await expect(page.locator('.player-panel')).toBeVisible();
};

const playerRow = (page: Page, nickname: string) =>
  page.locator('.player-panel li').filter({ hasText: nickname });

test.describe('연결이 끊겼다 돌아와도 게임에서 이탈하지 않는다', () => {
  test('오프라인 복귀 후에도 방에 남아 있고 남의 점수가 최신으로 보인다', async ({
    browser
  }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('chromium-desktop'), '한 번만 검증한다');
    test.setTimeout(90_000);

    const contexts: BrowserContext[] = [];
    const open = async (): Promise<Page> => {
      const context = await browser.newContext();
      // setOffline은 이미 열린 WebSocket을 끊지 못하므로, 소켓을 직접 붙잡아 둔다.
      await context.addInitScript(() => {
        const Original = window.WebSocket;
        const opened: WebSocket[] = [];
        (window as unknown as { __sockets: WebSocket[] }).__sockets = opened;
        class TrackedWebSocket extends Original {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            opened.push(this);
          }
        }
        window.WebSocket = TrackedWebSocket as unknown as typeof WebSocket;
      });
      contexts.push(context);
      return context.newPage();
    };
    const socketCount = (page: Page): Promise<number> =>
      page.evaluate(() => (window as unknown as { __sockets: WebSocket[] }).__sockets.length);

    try {
      const hostPage = await open();
      await hostPage.goto('/');
      await hostPage.getByLabel('닉네임').fill('방장');
      await hostPage.getByRole('button', { name: '방 만들기' }).click();
      await expect(hostPage.locator('.player-panel')).toBeVisible();

      const roomCode = (await hostPage.locator('.room-code-button').innerText())
        .match(/[1-9][0-9]{2}/)?.[0];
      expect(roomCode, '방번호를 화면에서 찾지 못했다').toBeTruthy();

      const solverPage = await open();
      await joinRoom(solverPage, roomCode!, '정답자');
      const watcherPage = await open();
      await joinRoom(watcherPage, roomCode!, '관전자');
      await expect(hostPage.locator('.player-panel li')).toHaveCount(3);

      // 방장이 제시어를 확정해 라운드를 시작한다.
      await hostPage.locator('#keyword').fill('사과');
      await hostPage.getByRole('button', { name: '제시어 확정 및 시작' }).click();

      // 정답자가 맞혀서 점수가 생긴다.
      const guessInput = solverPage.locator('.guess-form input, .guess-input input').first();
      await expect(guessInput).toBeVisible({ timeout: 10_000 });
      await guessInput.fill('사과');
      await guessInput.press('Enter');

      // 방장 화면에 점수가 반영될 때까지 기다린다.
      await expect(playerRow(hostPage, '정답자')).not.toContainText('0점', { timeout: 10_000 });
      const expectedSolverScore = (await playerRow(hostPage, '정답자').innerText())
        .match(/(\d+)점/)?.[1];
      expect(expectedSolverScore).toBeTruthy();

      // 관전자의 연결이 끊긴다(지하철 진입, 화면 꺼짐 등).
      const socketsBefore = await socketCount(watcherPage);
      await watcherPage.evaluate(() => {
        const sockets = (window as unknown as { __sockets: WebSocket[] }).__sockets;
        sockets[sockets.length - 1]!.close();
      });

      // 클라이언트가 스스로 새 연결을 열어야 한다.
      await expect
        .poll(() => socketCount(watcherPage), { timeout: 30_000 })
        .toBeGreaterThan(socketsBefore);

      // 방에서 튕기지 않고 다시 연결되어야 한다.
      await expect(watcherPage.locator('.connection-chip')).toHaveText('연결됨', {
        timeout: 30_000
      });
      await expect(watcherPage.locator('.player-panel')).toBeVisible();
      await expect(watcherPage.locator('.player-panel li')).toHaveCount(3);

      // 그리고 남의 점수가 방장 화면과 일치해야 한다(0점으로 얼어붙지 않는다).
      await expect(playerRow(watcherPage, '정답자')).toContainText(
        `${expectedSolverScore}점`,
        { timeout: 15_000 }
      );
    } finally {
      for (const context of contexts) await context.close();
    }
  });
});
