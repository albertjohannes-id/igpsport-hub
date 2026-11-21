import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });
for (const provider of ['igpsport', 'garmin'] as const) {
  test(`${provider} recent account selection and narrow login layout`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.addInitScript(() => {
      localStorage.setItem(
        'apex-recent-accounts',
        JSON.stringify({
          igpsport: [{ username: 'igps@example.invalid', lastUsed: Date.now() }],
          garmin: [{ username: 'garmin@example.invalid', lastUsed: Date.now() }],
        }),
      );
    });
    await page.route('**/api/**', (route) =>
      route.fulfill({
        json: {
          mode: 'local',
          capabilities: { login: true, transfer: true },
          sessions: {
            igpsport: { state: provider === 'igpsport' ? 'disconnected' : 'connected' },
            garmin: { state: provider === 'garmin' ? 'disconnected' : 'connected' },
          },
          history: [],
          activities: [],
          hasMore: false,
        },
      }),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Connect account', exact: true }).click();
    const input = page.getByLabel('Email or username');
    const account = provider === 'igpsport' ? 'igps@example.invalid' : 'garmin@example.invalid';
    await input.click();
    await page.getByRole('button', { name: account, exact: true }).click();
    await expect(input).toHaveValue(account);
    await expect(page.getByRole('group', { name: 'Recent accounts' })).toHaveCount(0);
    await input.fill('');
    await input.tap();
    await page.getByRole('button', { name: account, exact: true }).tap();
    await expect(input).toHaveValue(account);
    await input.fill('another@example.invalid');
    await expect(input).toHaveValue('another@example.invalid');
    await input.press('Escape');
    await page.getByLabel('Password', { exact: true }).click();
    const checkbox = page.getByLabel('Remember account on this device');
    const box = await checkbox.boundingBox();
    const text = await page
      .getByText('Remember account on this device', { exact: true })
      .boundingBox();
    expect(box).not.toBeNull();
    expect(text!.x - (box!.x + box!.width)).toBeLessThanOrEqual(12);
    expect(text!.x + text!.width).toBeLessThanOrEqual(320);
    expect(
      await page.getByRole('dialog').evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await expect(
      page.getByText('Remembers your email or username only', { exact: false }),
    ).toHaveCount(0);
    await page.screenshot({ path: `test-results/login-${testInfo.project.name}-${provider}.png` });
  });
}
