import { test, expect, type Page } from '@playwright/test';

const ride = {
  id: '123',
  provider: 'igpsport',
  title: 'Test ride',
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
async function fixture(page: Page, connected = true, outcome = 'confirmed', scope?: string) {
  let uploads = 0,
    attempts = 0,
    synced = false;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith('/status'))
      body = {
        mode: 'local',
        capabilities: { login: true, transfer: true },
        sessions: {
          igpsport: { state: connected ? 'connected' : 'disconnected' },
          garmin: { state: 'connected' },
        },
        history: [],
        ...(scope ? { historyScope: scope } : {}),
      };
    else if (url.pathname.endsWith('/login')) {
      attempts++;
      if (attempts === 1)
        return route.fulfill({
          status: 401,
          json: { error: 'Incorrect email/username or password. Please try again.' },
        });
      connected = true;
      body = { connected: true };
    } else if (url.pathname.endsWith('/transfer')) {
      uploads++;
      synced = true;
      body = {
        sourceId: '123',
        title: 'Test ride',
        state: outcome,
        activityId: outcome === 'confirmed' ? '456' : null,
        at: 1,
      };
    } else if (url.pathname.endsWith('/check'))
      body = { sourceId: '123', title: 'Test ride', state: 'confirmed', activityId: '456', at: 1 };
    else if (url.pathname.includes('/detail/')) body = ride;
    else if (url.pathname.endsWith('/disconnect')) {
      connected = false;
      body = { disconnected: true };
    } else
      body = {
        activities: [{ ...ride, syncStatus: synced ? outcome : 'unknown' }],
        hasMore: false,
      };
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Check connections', exact: true })).toBeEnabled();
  return { uploads: () => uploads };
}

test('saved session, search, detail and explicit single upload confirmation', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'iGPSPORT connected', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search loaded activities' }).fill('absent');
  await expect(page.getByText('No matching activities')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('button', { name: /Test ride Oct/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Send to Garmin', exact: true }).click();
  expect(state.uploads()).toBe(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.uploads()).toBe(0);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send to Garmin', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm transfer' }).click();
  await expect(page.getByText('Your ride is in Garmin.')).toBeVisible();
  expect(state.uploads()).toBe(1);
  await expect(page.getByRole('checkbox')).toBeDisabled();
});

test('wrong login allows retry and clears password; dialog supports Escape', async ({ page }) => {
  await fixture(page, false);
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.getByLabel('Email or username').fill('test@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('test-only');
  await page.getByRole('dialog').getByRole('button', { name: 'Connect account' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.getByLabel('Password', { exact: true }).fill('test-only-retry');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).first().click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Enter submits once with shared pending spinner and disabled submit', async ({ page }) => {
  await fixture(page, false);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submissions = 0;
  await page.route('**/api/igpsport/login', async (route) => {
    submissions++;
    await pending;
    await route.fulfill({ status: 401, json: { error: 'Incorrect password. Please try again.' } });
  });
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.getByLabel('Email or username').fill('test@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  const submit = page.getByRole('button', { name: 'Connecting…', exact: true });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect(submit.locator('.spinner')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).press('Enter');
  expect(submissions).toBe(1);
  release();
  await expect(page.getByRole('alert')).toContainText('Incorrect password');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Connect account' }),
  ).toBeEnabled();
});

test('uncertain upload offers verification without another upload', async ({ page }) => {
  const state = await fixture(page, true, 'unconfirmed');
  await page.getByRole('button', { name: 'iGPSPORT connected', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send to Garmin', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm transfer' }).click();
  await expect(page.getByText('Upload needs a status check.')).toBeVisible();
  await page.locator('.row-action').click();
  await page.getByRole('button', { name: 'Check Garmin status', exact: true }).click();
  await expect(page.getByText('Your ride is in Garmin.')).toBeVisible();
  expect(state.uploads()).toBe(1);
});

test('unconfirmed result can be verified inline from the result banner', async ({ page }) => {
  const state = await fixture(page, true, 'unconfirmed');
  await page.getByRole('button', { name: 'iGPSPORT connected', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send to Garmin', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm transfer' }).click();
  await expect(page.getByText('Upload needs a status check.')).toBeVisible();
  expect(state.uploads()).toBe(1);
  await page.locator('.result').getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.getByText('Your ride is in Garmin.')).toBeVisible();
  expect(state.uploads()).toBe(1);
});

test('compare tab suggests rides that never went through the Hub', async ({ page }) => {
  const paired = {
    ...ride,
    id: '201',
    title: 'Morning spin',
    deviceName: null,
  };
  const alone = { ...ride, id: '202', title: 'Evening spin', deviceName: null };
  const echoed = {
    ...ride,
    id: 'g1',
    provider: 'garmin' as const,
    title: 'Morning spin Garmin duplicate',
    deviceName: null,
    distanceMeters: 30600,
  };
  let uploads = 0;
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
      body = { activities: [paired, alone], hasMore: false };
    else if (url.pathname.includes('/garmin/activities'))
      body = { activities: [echoed], hasMore: false };
    else if (url.pathname.endsWith('/transfer')) {
      uploads++;
      body = {
        sourceId: alone.id,
        title: alone.title,
        state: 'confirmed',
        activityId: '456',
        at: 1,
      };
    } else body = { activities: [], hasMore: false };
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compare your rides' })).toBeVisible();
  await expect(page.getByText(/2 iGPSPORT rides · 1 Garmin rides compared/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Not yet seen in Garmin' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Likely already in Garmin' })).toBeVisible();
  await expect(page.locator('.compare-pair')).toContainText('Morning spin');
  await expect(page.locator('.compare-pair')).toContainText('Same day');
  const card = page.locator('.compare-card', { hasText: 'Evening spin' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Send to Garmin', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm transfer' }).click();
  await expect(page.getByText('Your ride is in Garmin.')).toBeVisible();
  expect(uploads).toBe(1);
});

test('navigation, refresh, clear selection, Garmin details and disconnect', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Browse iGPSPORT activities →' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(page.getByRole('checkbox')).toBeVisible();
  await page.route('**/api/garmin/activities*', (route) =>
    route.fulfill({ json: { activities: [{ ...ride, provider: 'garmin' }], hasMore: false } }),
  );
  await page.route('**/api/garmin/detail/*', (route) =>
    route.fulfill({ json: { ...ride, provider: 'garmin' } }),
  );
  await page.getByRole('button', { name: 'Garmin Connect connected', exact: true }).click();
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  await expect(page.getByRole('link', { name: 'View in Garmin ↗' })).toHaveAttribute(
    'href',
    'https://connect.garmin.com/modern/activity/123',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'iGPSPORT Hub home' }).click();
  await page.getByRole('button', { name: 'Check connections', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check connections', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'iGPSPORT disconnected', exact: true }),
  ).toBeVisible();
});

test('provider rejection requests reconnect instead of showing stale activity access', async ({
  page,
}) => {
  await fixture(page);
  await page.route('**/api/igpsport/activities*', (route) =>
    route.fulfill({
      status: 401,
      json: { error: 'Your session expired. Please reconnect.', code: 'RECONNECT' },
    }),
  );
  await page.getByRole('button', { name: 'iGPSPORT connected', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(page.getByRole('button', { name: 'Connect account', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('pagination, empty/error states and keyboard entry', async ({ page }) => {
  await fixture(page);
  let calls = 0;
  await page.route('**/api/igpsport/activities*', (route) => {
    calls++;
    return route.fulfill({
      json: { activities: [{ ...ride, id: String(calls) }], hasMore: calls === 1 },
    });
  });
  await page.getByRole('button', { name: 'iGPSPORT connected', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Load older activities' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await page.route('**/api/igpsport/activities*', (route) =>
    route.fulfill({ json: { activities: [], hasMore: false } }),
  );
  await page.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(page.getByText('No activities yet', { exact: true })).toBeVisible();
  await page.route('**/api/igpsport/activities*', (route) =>
    route.fulfill({ status: 502, json: { error: 'Provider temporarily unavailable.' } }),
  );
  await page.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByRole('button', { name: 'iGPSPORT error', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeVisible();
  await page.route('**/api/igpsport/activities*', (route) =>
    route.fulfill({ json: { activities: [ride], hasMore: false } }),
  );
  await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'iGPSPORT connected', exact: true })).toBeVisible();
});

for (const width of [320, 390, 768, 1280])
  test(`responsive layout and both themes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixture(page);
    for (const theme of ['dark', 'light']) {
      const toggle = page.getByRole('button', { name: `Switch to ${theme} theme` });
      if (await toggle.count()) await toggle.click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole('button', { name: 'iGPSPORT connected', exact: true }).click();
      await expect(page.getByRole('checkbox')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole('button', { name: /Test ride Oct/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Home', exact: true }).click();
    }
  });

test('browser history persists after reload and is isolated by connected accounts', async ({
  page,
}) => {
  await fixture(page, true, 'confirmed', 'account-pair-one');
  await page.getByRole('button', { name: 'iGPSPORT connected', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send to Garmin', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm transfer' }).click();
  await expect(page.getByText('Your ride is in Garmin.')).toBeVisible();
  await page.reload();
  // Hash routing keeps the tab across reloads; history lives on Home.
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('Test ride');
  const history = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apex-transfer-history-v1')!),
  );
  expect(history).toHaveLength(1);
  expect(history[0].scope).toBe('account-pair-one');
  await page.unrouteAll();
  await fixture(page, true, 'confirmed', 'account-pair-two');
  await expect(page.getByText('No transfers yet.')).toBeVisible();
  await page.unrouteAll();
  await fixture(page, true, 'confirmed', 'account-pair-one');
  await expect(page.locator('.history-list')).toContainText('Test ride');
});

test('blocked local storage stops transfer before an upload request', async ({ page }) => {
  const state = await fixture(page, true, 'confirmed', 'account-pair-one');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'apex-transfer-history-v1') throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'iGPSPORT connected', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send to Garmin', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm transfer' }).click();
  await expect(page.getByText(/Browser storage is unavailable or full/)).toBeVisible();
  expect(state.uploads()).toBe(0);
});

test('lost transfer response leaves a local pending record that can be checked after reload', async ({
  page,
}) => {
  await fixture(page, true, 'confirmed', 'account-pair-one');
  await page.route('**/api/igpsport/transfer', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'iGPSPORT connected', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send to Garmin', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm transfer' }).click();
  await expect(page.getByText(/If the request was interrupted/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('Ride 123');
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('Test ride');
  await expect(
    page.locator('.history-list').getByRole('link', { name: /View ride/ }),
  ).toBeVisible();
});

test('login reports a blocked cookie instead of accepting an older saved session', async ({
  page,
}) => {
  await fixture(page, false);
  await page.route('**/api/igpsport/login', (route) =>
    route.fulfill({
      json: {
        connected: true,
        storage: 'browser',
        storageProof: 'new-session-proof',
      },
    }),
  );
  await page.route('**/api/storage', (route) =>
    route.fulfill({
      json: {
        saved: ['igpsport'],
        proofs: { igpsport: 'old-session-proof' },
      },
    }),
  );
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.getByLabel('Email or username').fill('test@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('fixture');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Connect account', exact: true })
    .click();
  await expect(page.getByText(/did not save the connection cookie/)).toBeVisible();
});
