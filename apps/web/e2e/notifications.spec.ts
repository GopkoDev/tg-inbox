import type { Browser, Page } from '@playwright/test';
import { expect, PASSWORD, test, type World } from './support/world.ts';

/**
 * The operator-notifications flows (AC-01, AC-04, AC-07, AC-12) in real browsers against the API,
 * an ephemeral database and the fake Bot API. Seeding goes through the HTTP API and the webhook,
 * never the UI under test; every wait is on visible text (5 s ceiling, the 3 s live target).
 * Headless Chromium shows no OS notifications, so the desktop card is asserted by state only.
 */

const OWNER = 'boss@example.test';
const OPERATOR = 'ana@example.test';
const WAIT = { timeout: 5_000 };

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'));
}

async function open(browser: Browser, email: string, workspaceId: string, path = '/inbox') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  await page.goto(`/w/${workspaceId}${path}`);
  return { context, page };
}

const rows = (page: Page) =>
  page.getByRole('list', { name: 'Conversations' }).getByRole('listitem');
const bubble = (page: Page, text: string) => page.getByTestId('bubble').getByText(text);
const nav = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });

/** Acme Flowers: an owner (Olga), an operator (Ana) and a connected bot. */
async function acme(world: World) {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', OWNER, 'Olga');
  await world.joinOperator(OWNER, workspaceId, OPERATOR, 'Ana');
  const token = world.botToken(650_001n);
  await world.scriptBot(token, {});
  await world.connectBot(OWNER, workspaceId, token);
  return { workspaceId, token };
}

test('the attention count follows the messages across pages: title and Inbox badge (AC-01)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  const ana = await open(browser, OPERATOR, workspaceId, '/contacts');
  await expect(ana.page).toHaveTitle('tg-inbox');
  await expect(nav(ana.page).getByLabel(/need you|needs you/)).toHaveCount(0);

  expect(await world.customerWrites(token, 750_001, 'Do you deliver?', 'Zoe')).toBe(200);
  await expect(ana.page).toHaveTitle('(1) tg-inbox', WAIT);
  await expect(nav(ana.page).getByLabel('1 conversation needs you')).toBeVisible(WAIT);

  // Still counted after moving to Settings; a second message in another conversation makes 2.
  await ana.page.goto(`/w/${workspaceId}/settings/notifications`);
  expect(await world.customerWrites(token, 750_002, 'Price of tulips?', 'Yan')).toBe(200);
  await expect(ana.page).toHaveTitle('(2) tg-inbox', WAIT);

  // Reading both conversations brings it to 0: no prefix, no number.
  await nav(ana.page).getByRole('link', { name: /Inbox/ }).click();
  await rows(ana.page).filter({ hasText: 'Zoe' }).click();
  await expect(bubble(ana.page, 'Do you deliver?')).toBeVisible(WAIT);
  await rows(ana.page).filter({ hasText: 'Yan' }).click();
  await expect(bubble(ana.page, 'Price of tulips?')).toBeVisible(WAIT);
  await expect(ana.page).toHaveTitle('tg-inbox', WAIT);
  await expect(nav(ana.page).getByLabel(/need you|needs you/)).toHaveCount(0);

  await ana.context.close();
});

test('connect Telegram: the link, Start through the webhook turns the dialog Connected, Disconnect (AC-04)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  const ana = await open(browser, OPERATOR, workspaceId, '/settings/notifications');
  const page = ana.page;

  // The desktop card: headless Chromium has no usable notifications, so it is Off or Not available.
  await expect(page.getByRole('heading', { name: 'Desktop notifications' })).toBeVisible(WAIT);
  await expect(
    page
      .locator('div', { has: page.getByRole('heading', { name: 'Desktop notifications' }) })
      .getByText(/^(Off|Not available)$/)
      .first(),
  ).toBeVisible();

  await expect(page.getByText('Not connected')).toBeVisible(WAIT);
  await page.getByRole('button', { name: 'Connect Telegram' }).click();

  const dialog = page.getByRole('dialog', { name: 'Connect Telegram' });
  await expect(dialog.getByRole('link', { name: 'Open in Telegram' })).toBeVisible(WAIT);
  await expect(dialog.getByText('Waiting for you to press Start in Telegram…')).toBeVisible();
  const link = (await dialog.locator('p.select-all').textContent())!.trim();
  const payload = /start=(tgi_[A-Za-z0-9_-]+)/.exec(link)?.[1];
  expect(payload).toBeTruthy();

  // Ana presses Start in the chat: Telegram posts /start <payload> to the bot's webhook.
  expect(await world.customerWrites(token, 760_001, `/start ${payload}`, 'Ana')).toBe(200);
  await expect(dialog.getByText('Connected as Ana.')).toBeVisible(WAIT);
  // The bot's answer in the chat goes out through the queue.
  await expect
    .poll(
      async () =>
        (await world.sentMessages(token)).some((m) => String(m.text).includes('Acme Flowers')),
      { timeout: 10_000 },
    )
    .toBe(true);
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByText(/^Connected as Ana since /)).toBeVisible();
  // Starting through the link made no contact and no conversation.
  await page.goto(`/w/${workspaceId}/inbox`);
  await expect(rows(page)).toHaveCount(0, WAIT);

  await page.goto(`/w/${workspaceId}/settings/notifications`);
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText('Not connected')).toBeVisible(WAIT);
  await expect(page.getByRole('button', { name: 'Connect Telegram' })).toBeVisible();

  await ana.context.close();
});

test('ping links: the conversation and the mine lens open through sign-in; a foreign account gets not found (AC-07, AC-12)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  const other = await world.workspaceWithOwner('Bolt Bikes', 'chief@example.test');
  expect(other).not.toBe(workspaceId);
  expect(await world.customerWrites(token, 770_001, 'Is it still fresh?', 'Zoe')).toBe(200);
  const conversationId = await world.conversationId(OPERATOR, workspaceId, 'Zoe');
  await world.assign(OPERATOR, workspaceId, 'Zoe', 'Ana');

  // Signed out: the link leads to sign-in and back to the thread.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/w/${workspaceId}/inbox/${conversationId}`);
  await expect(page).toHaveURL(/\/sign-in$/, WAIT);
  await page.getByLabel('Email').fill(OPERATOR);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/inbox/${conversationId}$`), WAIT);
  await expect(bubble(page, 'Is it still fresh?')).toBeVisible(WAIT);

  // The combined ping's lens link.
  await page.goto(`/w/${workspaceId}/inbox?assignee=mine`);
  await expect(rows(page)).toHaveCount(1, WAIT);
  await expect(rows(page).filter({ hasText: 'Zoe' })).toBeVisible();
  await context.close();

  // An account of another workspace: not found, nothing of Acme shown.
  const chief = await open(browser, 'chief@example.test', other, '/inbox');
  await chief.page.goto(`/w/${workspaceId}/inbox/${conversationId}`);
  await expect(chief.page.getByText('Page not found')).toBeVisible(WAIT);
  await expect(chief.page.getByText('Is it still fresh?')).toHaveCount(0);
  await expect(chief.page.getByText('Acme Flowers')).toHaveCount(0);
  await chief.context.close();
});

test('Settings is role-filtered and the owner sees the Team mark after a connect (AC-12)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);

  const ana = await open(browser, OPERATOR, workspaceId, '/settings');
  await expect(ana.page).toHaveURL(new RegExp(`/settings/notifications$`), WAIT);
  const settingsNav = ana.page.getByRole('navigation', { name: /settings/i });
  await expect(settingsNav.getByRole('link', { name: 'Notifications' })).toBeVisible();
  await expect(settingsNav.getByRole('link', { name: 'Team' })).toHaveCount(0);
  await expect(settingsNav.getByRole('link', { name: 'Bot' })).toHaveCount(0);

  // Ana connects; the owner then sees Telegram pings On for Ana, Off for themselves.
  await ana.page.getByRole('button', { name: 'Connect Telegram' }).click();
  const dialog = ana.page.getByRole('dialog', { name: 'Connect Telegram' });
  const link = (await dialog.locator('p.select-all').textContent(WAIT))!.trim();
  const payload = /start=(tgi_[A-Za-z0-9_-]+)/.exec(link)![1];
  expect(await world.customerWrites(token, 760_002, `/start ${payload}`, 'Ana')).toBe(200);
  await expect(dialog.getByText('Connected as Ana.')).toBeVisible(WAIT);
  await ana.context.close();

  const olga = await open(browser, OWNER, workspaceId, '/settings/team');
  await expect(olga.page.getByRole('columnheader', { name: 'Telegram pings' })).toBeVisible(WAIT);
  await expect(olga.page.getByRole('row').filter({ hasText: ANA_EMAIL })).toContainText('On');
  await expect(olga.page.getByRole('row').filter({ hasText: OWNER })).toContainText('Off');
  // The owner sees the mark only: no Telegram name anywhere in Team.
  await expect(olga.page.getByText('Connected as')).toHaveCount(0);
  await olga.context.close();
});

const ANA_EMAIL = OPERATOR;
