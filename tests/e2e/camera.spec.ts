import { test, expect } from '@playwright/test';

// Caméra simulée par Chromium : vérifie que l'aperçu s'affiche et que le déclencheur capture une image.
test.use({
  permissions: ['camera'],
  launchOptions: {
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  }
});

test('aperçu caméra en direct puis capture', async ({ page }) => {
  await page.goto('/scanner');
  await expect.poll(() => page.evaluate(() => document.querySelector('video')?.videoWidth ?? 0)).toBeGreaterThan(0);
  await page.locator('.shutter').click();
  await page.waitForURL('**/resultats');
  await expect(page.getByRole('heading', { name: 'Œuvre identifiée' })).toBeVisible();
});
