import { test, expect } from '@playwright/test';

const ride = {
  id: '123',
  provider: 'igpsport',
  title: 'Long test ride title that keeps going and going for narrow screens',
  sourceDateTime: '2026.10.17',
  startTimeUtc: null,
  timePrecision: 'date',
  distanceMeters: 30580,
  movingSeconds: 5940,
  timerSeconds: null,
  elapsedSeconds: 6100,
  averageSpeedMps: 5.1,
  ascentMeters: null,
  deviceName: 'BSC500',
  syncStatus: 'unknown',
};

async function mock(
  page: import('@playwright/test').Page,
  states: { igp: string; garmin: string },
) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith('/status'))
      body = {
        mode: 'local',
        capabilities: { login: true, transfer: true },
        sessions: { igpsport: { state: states.igp }, garmin: { state: states.garmin } },
        history: [],
      };
    else body = { activities: [ride], hasMore: false };
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Check connections', exact: true })).toBeEnabled();
}

for (const width of [320, 390]) {
  test(`both disconnected, home, ${width}px, both themes`, async ({ page }) => {
    await mock(page, { igp: 'disconnected', garmin: 'disconnected' });
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      const toggle = page.getByRole('button', { name: `Switch to ${theme} theme` });
      if (await toggle.count()) await toggle.click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.getByText('Connect both accounts to transfer rides.')).toBeVisible();
    }
  });

  test(`igpsport only connected, igpsport tab with garmin callout, ${width}px`, async ({
    page,
  }) => {
    await mock(page, { igp: 'connected', garmin: 'disconnected' });
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      const toggle = page.getByRole('button', { name: `Switch to ${theme} theme` });
      if (await toggle.count()) await toggle.click();
      await page.getByRole('button', { name: 'iGPSPORT connected', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.getByText('Connect Garmin Connect before sending rides')).toBeVisible();
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });

  test(`help modal, ${width}px, both themes`, async ({ page }) => {
    await mock(page, { igp: 'connected', garmin: 'connected' });
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      const toggle = page.getByRole('button', { name: `Switch to ${theme} theme` });
      if (await toggle.count()) await toggle.click();
      await page.getByRole('button', { name: 'See how it works' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });

  test(`compare tab with suggestions, ${width}px, both themes`, async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      let body: unknown;
      if (url.pathname.endsWith('/status'))
        body = {
          mode: 'local',
          capabilities: { login: true, transfer: true },
          sessions: { igpsport: { state: 'connected' }, garmin: { state: 'connected' } },
          history: [],
        };
      else if (url.pathname.includes('/igpsport/activities'))
        body = {
          activities: [
            { ...ride, id: '201', title: 'Morning spin paired ride', deviceName: null },
            { ...ride, id: '202', title: 'Evening spin alone ride', deviceName: null },
          ],
          hasMore: false,
        };
      else if (url.pathname.includes('/garmin/activities'))
        body = {
          activities: [
            {
              ...ride,
              id: 'g1',
              provider: 'garmin',
              title: 'Morning spin Garmin duplicate',
              deviceName: null,
              distanceMeters: 30600,
            },
          ],
          hasMore: false,
        };
      else body = { activities: [], hasMore: false };
      await route.fulfill({ json: body });
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Check connections' })).toBeEnabled();
    for (const theme of ['light', 'dark']) {
      const toggle = page.getByRole('button', { name: `Switch to ${theme} theme` });
      if (await toggle.count()) await toggle.click();
      await page.getByRole('button', { name: 'Compare', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Compare rides' })).toBeVisible();
      await expect(page.getByText('2 iGPSPORT rides · 1 Garmin rides compared')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(await page.locator('.compare-pair').count()).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Home', exact: true }).click();
    }
  });
}
