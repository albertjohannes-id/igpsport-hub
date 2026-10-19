import { test, expect } from '@playwright/test';

test('production headers, install assets and safe offline fallback', async ({
  page,
  context,
  request,
}) => {
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(response?.headers()['content-security-policy']).not.toContain('unsafe-inline');
  expect(response?.headers()['x-frame-options']).toBe('DENY');
  await expect(page.getByRole('heading', { name: 'Your ride connections.' })).toBeVisible();
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok()).toBe(true);
    expect(image.headers()['content-type']).toContain('image/png');
  }
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const entries = await Promise.all(
      keys.map(async (key) =>
        (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname),
      ),
    );
    return entries.flat().sort();
  });
  expect(cached).toEqual(['/offline.css', '/offline.html']);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'You’re offline.' })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Your ride connections.' })).toBeVisible();
});

test('cloud API fails closed with no-store and method restrictions', async ({ request }) => {
  const status = await request.get('/api/status');
  expect(status.headers()['cache-control']).toBe('no-store');
  expect((await status.json()).capabilities.login).toBe(false);
  const login = await request.post('/api/igpsport/login', {
    data: { username: 'fixture', password: 'fixture' },
  });
  expect(login.status()).toBe(405);
  expect(login.headers()['x-content-type-options']).toBe('nosniff');
});
