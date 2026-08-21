import { expect, test } from '@playwright/test';

/**
 * 제시어 다시 뽑기는 라운드마다 5번까지이고, 남은 횟수가 버튼에 보여야 한다.
 * 직접 입력해서 확정하는 것은 제한 대상이 아니다.
 */
test('다시 뽑기는 5번까지이고 남은 횟수가 버튼에 보인다', async ({ browser }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('chromium-desktop'), '한 번만 검증한다');
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

    // 라운드를 시작할 수 있으려면 추측할 참여자가 필요하다.
    const guest = await guestContext.newPage();
    await guest.goto('/');
    await guest.getByLabel('닉네임').fill('참여자');
    await guest.getByLabel('방번호').fill(roomCode!);
    await guest.getByRole('button', { name: '입장하기' }).click();
    await expect(guest.locator('.player-panel')).toBeVisible();

    const shuffle = host.locator('.shuffle-button');
    await expect(shuffle).toContainText('5／5');

    for (const remaining of [4, 3, 2, 1, 0]) {
      await expect(shuffle).toBeEnabled();
      await shuffle.click();
      await expect(shuffle).toContainText(`${remaining}／5`);
    }

    // 다 쓰면 눌리지 않는다.
    await expect(shuffle).toBeDisabled();

    // 그래도 직접 입력해서 라운드를 시작하는 길은 열려 있어야 한다.
    await host.locator('#keyword').fill('사과');
    await host.getByRole('button', { name: '제시어 확정 및 시작' }).click();
    await expect(guest.locator('.guess-input')).toBeVisible();
    await expect(host.locator('.keyword-value, .keyword-hidden')).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
