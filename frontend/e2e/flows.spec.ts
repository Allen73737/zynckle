import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Main flows through the real UI against a real API: sign up, tour, projects and tasks,
 * public share links, and accessibility. Each test signs up its own account.
 */

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function signUp(page: Page) {
  const id = unique();
  await page.goto('/');
  // A fresh browser opens on sign-up; one that has signed in before opens on sign-in.
  const toRegister = page.getByRole('button', { name: /create an account/i });
  if (await toRegister.isVisible()) await toRegister.click();
  await page.getByLabel('Your name').fill(`E2E ${id}`);
  await page.getByLabel('Email address').fill(`e2e-${id}@example.test`);
  await page.locator('input[autocomplete="new-password"]').fill('correct-horse-42!');
  await page.getByRole('button', { name: 'Create your workspace' }).click();
  // First run: the tour opens once. Skip it.
  const tour = page.getByRole('dialog', { name: 'Welcome to Zynckle' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: /skip/i }).first().click();
  await expect(tour).toBeHidden();
  return id;
}

/** API calls from the signed-in browser (same cookies) with the CSRF header the app sends. */
const apiPost = (page: Page, path: string, data: unknown) => page.request.post(path, { data, headers: { 'X-Zynckle-Request': '1' } });

/** Fail on critical and serious accessibility problems (including colour contrast); list everything in the output. */
async function expectAccessible(page: Page, where: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
  for (const v of results.violations) console.log(`[axe ${where}] ${v.impact} ${v.id}: ${v.help} (${v.nodes.length})`);
  expect(blocking.map(v => `${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${where}`).toEqual([]);
}

test('sign up, the session is an HttpOnly cookie, and the tour shows once', async ({ page, context }) => {
  await signUp(page);
  const cookies = await context.cookies();
  const session = cookies.find(c => c.name === 'zynckle_session');
  expect(session?.httpOnly).toBe(true);
  // Scripts on the page cannot read it, and no token is kept in storage.
  expect(await page.evaluate(() => document.cookie)).not.toContain('zynckle_session');
  expect(await page.evaluate(() => localStorage.getItem('zynckle-token'))).toBe('cookie');
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Welcome to Zynckle' })).toBeHidden();
});

test('create a project and add a task to its board', async ({ page }) => {
  await signUp(page);
  await page.goto('/projects');
  await page.getByRole('button', { name: /new project/i }).first().click();
  const name = `Launch ${unique()}`;
  await page.getByLabel('Project name').fill(name);
  await page.locator('form.modal').getByRole('button', { name: /create/i }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Add task', exact: true }).first().click();
  await page.getByLabel('Task title').fill('Write the announcement');
  await page.locator('form.modal').getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('button', { name: /Write the announcement/ })).toBeVisible();

  // Calendar view renders the month grid.
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await expectAccessible(page, 'project board');
});

test('a public share link opens signed out, and stops after revoking', async ({ page, browser }) => {
  await signUp(page);
  const doc = await (await apiPost(page, '/api/documents', { title: 'Public spec', content: '<p>Hello from Zynckle</p>', type: 'rich-text' })).json();
  const link = await (await apiPost(page, `/api/documents/${doc.id}/share-links`, { expiresInDays: 7 })).json();

  const visitor = await browser.newContext(); // no cookies: a stranger with the link
  const view = await visitor.newPage();
  await view.goto(link.url);
  await expect(view.getByRole('heading', { name: 'Public spec' })).toBeVisible();
  await expect(view.getByText('Hello from Zynckle')).toBeVisible();
  await expectAccessible(view, 'public share page');

  await page.request.delete(`/api/share-links/${link.id}`, { headers: { 'X-Zynckle-Request': '1' } });
  await view.reload();
  await expect(view.getByRole('heading', { name: 'Link unavailable' })).toBeVisible();
  await visitor.close();
});

test('requests from the page without the CSRF header are refused', async ({ page }) => {
  await signUp(page);
  const forged = await page.request.post('/api/projects', { data: { name: 'Forged' } });
  expect(forged.status()).toBe(403);
});

test('sign-in page and overview are accessible', async ({ browser, page }) => {
  const fresh = await browser.newContext();
  const signIn = await fresh.newPage();
  await signIn.goto('/');
  await expect(signIn.getByRole('button', { name: /^(create your workspace|sign in)$/i })).toBeVisible();
  await expectAccessible(signIn, 'sign-in page');
  await fresh.close();

  await signUp(page);
  await expect(page.locator('.page-content')).toBeVisible();
  await expectAccessible(page, 'overview');
  // Both themes must meet contrast requirements.
  await page.evaluate(() => localStorage.setItem('zynckle-theme-choice', 'light'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expectAccessible(page, 'overview (light theme)');
});

test('the app fits a phone screen without sideways scrolling @phone', async ({ page }) => {
  await signUp(page);
  for (const path of ['/', '/projects', '/tasks', '/documents', '/team']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
});
