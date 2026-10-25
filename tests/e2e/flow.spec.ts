import { test, expect } from '@playwright/test';
import path from 'node:path';

const photo = path.resolve('tests/fixtures/painting.jpg');

test('scanner, consulter la fiche, enregistrer, questionner, retrouver après rechargement', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Mode démonstration')).toBeVisible();
  await page.getByRole('link', { name: /Photographier une œuvre/ }).click();
  await page.locator('[data-testid=file-input]').setInputFiles(photo);
  await page.waitForURL('**/resultats');
  await expect(page.getByRole('heading', { name: 'Œuvre identifiée' })).toBeVisible();
  await expect(page.getByText('Georges Seurat').first()).toBeVisible();
  await expect(page.getByText(/Notice trouvée/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Ouvrir la fiche' }).first().click();
  await expect(page.locator('.cartel')).toContainText('1926.224');
  await expect(page.locator('#sources')).toContainText('artic.edu'.replace('artic.edu', 'Art Institute'));
  await page.getByRole('button', { name: 'Ajouter à ma collection' }).click();
  await expect(page.getByRole('button', { name: /Dans ma collection/ })).toBeVisible();

  await page.getByRole('link', { name: 'Poser une question' }).click();
  await page.getByRole('button', { name: 'Pourquoi cette œuvre est-elle importante ?' }).click();
  await expect(page.locator('.msg-ai')).toContainText('Mode démonstration', { timeout: 10_000 });

  await page.goto('/collection');
  await page.reload();
  await expect(page.locator('.work')).toHaveCount(1);
  await page.getByRole('searchbox').fill('pointillisme inexistant');
  await expect(page.getByText('Aucune œuvre ne correspond')).toBeVisible();
  await page.getByRole('searchbox').fill('seurat');
  await expect(page.locator('.work')).toHaveCount(1);

  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).click()]);
  expect(csv.suggestedFilename()).toBe('cartel-collection.csv');
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
  expect(pdf.suggestedFilename()).toBe('cartel-collection.pdf');
  if (process.env.SAVE_PDF) await pdf.saveAs(process.env.SAVE_PDF);
});

test('ajouter notes, tags et collection thématique', async ({ page }) => {
  await page.goto('/scanner');
  await page.locator('[data-testid=file-input]').setInputFiles(photo);
  await page.waitForURL('**/resultats');
  await page.getByRole('button', { name: 'Ouvrir la fiche' }).first().click();
  await page.getByRole('button', { name: 'Ajouter à ma collection' }).click();
  await page.getByRole('button', { name: 'Notes, tags et collections' }).click();
  await page.getByLabel('Note personnelle').fill('Vue à Chicago');
  await page.getByLabel(/Tags/).fill('lumière, dimanche');
  await page.getByPlaceholder('Nouvelle collection').fill('Pointillisme');
  await page.getByRole('button', { name: 'Créer' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('« Vue à Chicago »')).toBeVisible();
  await page.goto('/collection');
  await page.getByRole('button', { name: 'Pointillisme' }).click();
  await expect(page.locator('.work')).toHaveCount(1);
  await page.getByRole('button', { name: '#dimanche' }).click();
  await expect(page.locator('.work')).toHaveCount(1);
});

test('rechercher dans les catalogues et ouvrir une notice', async ({ page }) => {
  await page.goto('/recherche');
  await page.getByLabel('Artiste').fill('Caillebotte');
  await page.getByRole('button', { name: /Rechercher dans les catalogues/ }).click();
  await page.getByText('Paris Street; Rainy Day').click();
  await expect(page.locator('.cartel')).toContainText('1964.336');
});
