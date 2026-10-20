import { test, expect, type Page } from '@playwright/test';

const repository = '/repositories/22222222-2222-4222-8222-222222222222';
async function login(page: Page, email = 'demo@localhost.test') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test('signs in, browses source, searches evidence, and opens history and impact', async ({
  page,
}) => {
  await login(page);
  await expect(page.getByText('fixture/browser-demo', { exact: true })).toBeVisible();
  await page.goto(`${repository}/files/src/auth.ts`);
  await expect(page.getByText('src/auth.ts', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('export function authenticate(token: string) {', { exact: true }),
  ).toBeVisible();
  await page.goto(`${repository}/search?q=authenticate`);
  await expect(page.getByRole('link', { name: 'src/auth.ts:1–3', exact: true })).toBeVisible();
  await page.goto(`${repository}/history?path=src%2Fauth.ts`);
  await expect(page.getByText('Introduce token authentication', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '#1 Add authentication' })).toBeVisible();
  await page.goto(`${repository}/impact?path=src%2Fauth.ts`);
  await expect(page.getByRole('heading', { name: 'Symbol references' })).toBeVisible();
  await page.goto(`${repository}/chat`);
  await expect(page.getByRole('link', { name: 'AI settings', exact: true }).last()).toBeVisible();
});

test('saves encrypted AI settings without returning a key, then removes them', async ({ page }) => {
  await login(page);
  await page.goto('/settings/ai');
  await page.getByLabel('Model ID').fill('fixture-model');
  await page.getByLabel('API key', { exact: true }).fill('fixture-private-key');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  const response = await page.request.get('/api/settings/ai');
  expect(await response.text()).not.toContain('fixture-private-key');
  await page.reload();
  await expect(page.getByLabel('Replace API key', { exact: false })).toHaveValue('');
  await page.getByRole('button', { name: 'Remove personal key' }).click();
  await expect(page.getByRole('status')).toContainText('Personal key removed.');
});

test('protects private routes and rejects a different owner', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/login/);
  expect((await page.request.get('/api/repositories')).status()).toBe(401);
  await login(page, 'other@localhost.test');
  expect((await page.request.get(`/api${repository}/history`)).status()).toBe(403);
  expect((await page.request.get(`/api${repository}/files`)).status()).toBe(403);
  await page.goto(`${repository}/chat`);
  await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible();
});
