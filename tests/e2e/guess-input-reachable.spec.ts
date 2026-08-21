import { expect, test, type Page } from '@playwright/test';

/**
 * 대표님 보고 증상: 가끔 캔버스가 정답 입력칸을 덮어 입력하기 힘들어진다.
 *
 * 원인은 캔버스 영역에 걸린 높이 하한(min-height, clamp의 최솟값, flex-shrink: 0)이었다.
 * 화면이 그 하한보다 짧으면 캔버스가 정답칸을 덮거나 화면 밖으로 밀어냈다.
 * 규칙은 하나다 — 정답칸이 먼저 자리를 잡고 캔버스는 남는 공간을 쓴다.
 */

/** 정답칸 한가운데를 실제로 누를 수 있는지, 그리고 화면 안에 있는지 본다. */
const inspectGuessInput = (page: Page) =>
  page.evaluate(() => {
    const input = document.querySelector('#guess') as HTMLElement | null;
    const stage = document.querySelector('.canvas-stage') as HTMLElement | null;
    if (!input || !stage) return null;
    const box = input.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      reachable: hit === input || input.contains(hit),
      coveredBy: `${hit?.tagName.toLowerCase() ?? '없음'}.${(hit as HTMLElement)?.className ?? ''}`,
      insideViewport: box.top >= 0 && box.bottom <= window.innerHeight,
      canvasHeight: Math.round(stage.getBoundingClientRect().height)
    };
  });

test.describe('정답 입력칸은 어떤 화면에서도 가려지지 않는다', () => {
  test('화면이 짧아져도 정답칸을 누를 수 있다', async ({ browser }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('chromium-desktop'), '뷰포트를 직접 바꾸며 한 번만 검증한다');
    test.setTimeout(120_000);

    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    try {
      const host = await hostContext.newPage();
      await host.goto('/');
      await host.getByLabel('닉네임').fill('방장');
      await host.getByRole('button', { name: '방 만들기' }).click();
      await expect(host.locator('.player-panel')).toBeVisible();
      const roomCode = (await host.locator('.room-code-button').innerText())
        .match(/[1-9][0-9]{2}/)?.[0];
      expect(roomCode).toBeTruthy();

      const guest = await guestContext.newPage();
      await guest.goto('/');
      await guest.getByLabel('닉네임').fill('추측이');
      await guest.getByLabel('방번호').fill(roomCode!);
      await guest.getByRole('button', { name: '입장하기' }).click();
      await expect(guest.locator('.player-panel')).toBeVisible();

      await host.locator('#keyword').fill('사과');
      await host.getByRole('button', { name: '제시어 확정 및 시작' }).click();
      await expect(guest.locator('.guess-input')).toBeVisible();

      // 모바일 키보드가 올라와 화면이 절반이 되는 상황까지 포함한다.
      const viewports = [
        { width: 1280, height: 900 },
        { width: 1280, height: 560 },
        { width: 1024, height: 640 },
        { width: 915, height: 412 },
        { width: 844, height: 540 },
        { width: 844, height: 390 },
        { width: 844, height: 280 },
        { width: 744, height: 560 },
        { width: 430, height: 932 },
        { width: 390, height: 844 },
        { width: 390, height: 420 },
        { width: 390, height: 300 },
        { width: 360, height: 640 },
        { width: 360, height: 400 }
      ];

      for (const viewport of viewports) {
        await guest.setViewportSize(viewport);
        await guest.waitForTimeout(120);
        const result = await inspectGuessInput(guest);
        const label = `${viewport.width}x${viewport.height}`;
        expect(result, `${label}: 정답칸을 찾지 못했다`).not.toBeNull();
        expect(
          result!.reachable,
          `${label}: 정답칸이 ${result!.coveredBy}에 가려졌다`
        ).toBe(true);
        expect(
          result!.insideViewport,
          `${label}: 정답칸이 화면 밖으로 밀려났다`
        ).toBe(true);
      }

      // 실제로 입력까지 되는지 확인한다.
      await guest.setViewportSize({ width: 844, height: 280 });
      await guest.locator('#guess').click();
      await guest.locator('#guess').fill('사과');
      await expect(guest.locator('#guess')).toHaveValue('사과');

      // 흔히 쓰는 화면에서는 캔버스가 그림을 그릴 만큼 넉넉해야 한다.
      for (const viewport of [
        { width: 1280, height: 900 },
        { width: 390, height: 844 },
        { width: 844, height: 390 }
      ]) {
        await guest.setViewportSize(viewport);
        await guest.waitForTimeout(120);
        const result = await inspectGuessInput(guest);
        expect(
          result!.canvasHeight,
          `${viewport.width}x${viewport.height}: 캔버스가 너무 납작하다`
        ).toBeGreaterThan(120);
      }
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
});
