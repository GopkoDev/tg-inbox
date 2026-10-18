import type { Browser, Page, WebSocket } from '@playwright/test';
import { expect, PASSWORD, test, type World } from './support/world.ts';

/**
 * The shared-inbox flows (AC-01, AC-06, AC-09, AC-13, AC-15, AC-16) in real browsers against the
 * API, an ephemeral database, the pg-boss delivery worker and the fake Bot API. Customer messages
 * are posted to the webhook by the test; every wait is on visible text (5 s ceiling).
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

/**
 * A signed-in browser context (its own cookie jar) on the workspace inbox; `sockets` are its live
 * sockets and `frames` every live frame they received, in order.
 */
async function openInbox(browser: Browser, email: string, workspaceId: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const sockets: WebSocket[] = [];
  const frames: string[] = [];
  page.on('websocket', (ws) => {
    sockets.push(ws);
    ws.on('framereceived', (frame) => frames.push(String(frame.payload)));
  });
  await signIn(page, email);
  await page.goto(`/w/${workspaceId}/inbox`);
  return { context, page, sockets, frames };
}

const rows = (page: Page) =>
  page.getByRole('list', { name: 'Conversations' }).getByRole('listitem');
/** A message or reply bubble in the open thread (the list preview repeats the same text). */
const bubble = (page: Page, text: string) => page.getByTestId('bubble').getByText(text);
const reply = (page: Page) => page.getByRole('textbox', { name: 'Reply' });

/** Acme Flowers: an owner (Olga), an operator (Ana) and a connected bot. */
async function acme(world: World) {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', OWNER, 'Olga');
  await world.joinOperator(OWNER, workspaceId, OPERATOR, 'Ana');
  const telegramBotId = 620_001n;
  const token = world.botToken(telegramBotId);
  await world.scriptBot(token, {});
  await world.connectBot(OWNER, workspaceId, token);
  return { workspaceId, token, telegramBotId };
}

test('a customer message reaches the owner and the operator live, in the list and the open thread (AC-01, AC-15)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  for (let i = 1; i <= 30; i++) {
    expect(await world.customerWrites(token, 730_000 + i, `Question ${i}`, `Customer${i}`)).toBe(
      200,
    );
  }

  const owner = await openInbox(browser, OWNER, workspaceId);
  const operator = await openInbox(browser, OPERATOR, workspaceId);
  for (const { page } of [owner, operator]) {
    await expect(rows(page)).toHaveCount(30, WAIT);
    await expect(rows(page).first()).toContainText('Customer30');
    await expect(page.getByText('Sample data')).toHaveCount(0);
  }
  await expect(rows(operator.page).first()).toContainText('Question 30');
  await expect(rows(operator.page).first()).toContainText('Waiting for a reply');

  // The operator opens Customer30's thread; a message from that customer lands live in it.
  await rows(operator.page).first().click();
  await expect(bubble(operator.page, 'Question 30')).toBeVisible(WAIT);
  expect(await world.customerWrites(token, 730_030, 'Is it still fresh?', 'Customer30')).toBe(200);
  await expect(bubble(operator.page, 'Is it still fresh?')).toBeVisible(WAIT);

  // A customer writing for the first time appears at the top of both lists, without reloading.
  expect(await world.customerWrites(token, 730_099, 'Hello, new here', 'Newcomer')).toBe(200);
  for (const { page } of [owner, operator]) {
    await expect(rows(page)).toHaveCount(31, WAIT);
    await expect(rows(page).first()).toContainText('Newcomer');
    await expect(rows(page).first()).toContainText('Hello, new here');
  }

  await owner.context.close();
  await operator.context.close();
});

test('a reply shows Sending, then Sent, moves the row to the top and clears the waiting marker (AC-06)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 731_001, 'Do you deliver today?', 'Zoe')).toBe(200);
  expect(await world.customerWrites(token, 731_002, 'Price of tulips?', 'Yan')).toBe(200);
  // Hold Telegram's answer so "Sending" can be seen before "Sent".
  await world.scriptBot(token, { sendMessage: [{ kind: 'hang', ms: 1_500 }] });

  const operator = await openInbox(browser, OPERATOR, workspaceId);
  const owner = await openInbox(browser, OWNER, workspaceId);
  await expect(rows(operator.page).first()).toContainText('Yan', WAIT);
  await rows(operator.page).filter({ hasText: 'Zoe' }).click();
  await expect(bubble(operator.page, 'Do you deliver today?')).toBeVisible(WAIT);

  await reply(operator.page).fill('Yes, until 6 pm');
  await reply(operator.page).press('Enter');

  const delivery = operator.page.getByTestId('reply-delivery');
  await expect(bubble(operator.page, 'Yes, until 6 pm')).toBeVisible(WAIT);
  await expect(delivery.getByText('Sending')).toBeVisible(WAIT);
  await expect(reply(operator.page)).toHaveValue('');
  await expect(delivery.getByText('Sent')).toBeVisible(WAIT);

  expect(await world.sentMessages(token)).toHaveLength(1);
  // The conversation moves to the top for the whole team and stops waiting.
  for (const { page } of [operator, owner]) {
    await expect(rows(page).first()).toContainText('Zoe', WAIT);
    await expect(rows(page).first()).toContainText('Yes, until 6 pm');
    await expect(rows(page).first()).not.toContainText('Waiting for a reply');
    await expect(rows(page).nth(1)).toContainText('Waiting for a reply');
  }

  await owner.context.close();
  await operator.context.close();
});

test('a teammate replied while the operator typed: ask first, send only after Send anyway (AC-16, AC-15)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 732_001, 'Can I change my order?', 'Zoe')).toBe(200);

  const operator = await openInbox(browser, OPERATOR, workspaceId);
  const owner = await openInbox(browser, OWNER, workspaceId);
  for (const { page } of [operator, owner]) {
    await rows(page).first().click();
    await expect(bubble(page, 'Can I change my order?')).toBeVisible(WAIT);
  }

  await reply(operator.page).fill('Sure, what would you like to change?');
  await reply(owner.page).fill('Yes, call us');
  await reply(owner.page).press('Enter');
  // The teammate's reply appears live in the operator's open thread, with the author's name.
  await expect(bubble(operator.page, 'Yes, call us')).toBeVisible(WAIT);
  await expect(
    operator.page.getByTestId('bubble').filter({ hasText: 'Yes, call us' }),
  ).toContainText('Olga');
  await expect.poll(() => world.sentMessages(token).then((m) => m.length), WAIT).toBe(1);

  await reply(operator.page).press('Enter');
  const dialog = operator.page.getByRole('alertdialog', { name: 'A teammate just replied' });
  await expect(dialog).toContainText('Olga replied to this customer');
  expect(await world.sentMessages(token)).toHaveLength(1); // nothing sent before the confirmation

  await dialog.getByRole('button', { name: 'Send anyway' }).click();
  await expect(operator.page.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(() => world.sentMessages(token).then((m) => m.length), WAIT).toBe(2);
  await expect(bubble(operator.page, 'Sure, what would you like to change?')).toBeVisible(WAIT);

  await owner.context.close();
  await operator.context.close();
});

test('a bot needing a new token: readable, role-specific composer, and reply works again after the owner fixes it (AC-13)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token, telegramBotId } = await acme(world);
  expect(await world.customerWrites(token, 733_001, 'Are you open?', 'Zoe')).toBe(200);

  const owner = await openInbox(browser, OWNER, workspaceId);
  const operator = await openInbox(browser, OPERATOR, workspaceId);
  for (const { page } of [owner, operator]) {
    await rows(page).first().click();
    await expect(page.getByText('Are you open?')).toBeVisible(WAIT);
    await expect(reply(page)).toBeEnabled();
  }

  await world.scriptBot(token, { getMe: 'unauthorized' });
  await world.healthTick();

  const notice = "Replies can't be sent — the bot is not working and needs a new token.";
  for (const { page } of [owner, operator]) {
    await expect(page.getByText(notice)).toBeVisible(WAIT);
    await expect(reply(page)).toBeDisabled();
    await expect(page.getByTestId('bubble').getByText('Are you open?')).toBeVisible(); // still readable
  }
  await expect(owner.page.getByRole('link', { name: 'Open bot settings' })).toBeVisible();
  await expect(operator.page.getByText('Ask a business owner to fix the bot.')).toBeVisible();
  await expect(operator.page.getByRole('link', { name: 'Open bot settings' })).toHaveCount(0);

  // The owner pastes a new token for the same bot, in another tab; the open inboxes follow.
  const fresh = world.botToken(telegramBotId);
  await world.scriptBot(fresh, {});
  const settings = await owner.context.newPage();
  await settings.goto(`/w/${workspaceId}/settings/bot`);
  await settings.getByRole('button', { name: 'Paste new token' }).click();
  const dialog = settings.getByRole('dialog');
  await dialog.getByLabel('Bot token').fill(fresh);
  await dialog.getByRole('button', { name: 'Save token' }).click();
  await expect(settings.getByText('Connected', { exact: true })).toBeVisible(WAIT);

  for (const { page } of [owner, operator]) {
    await expect(page.getByText(notice)).toHaveCount(0, WAIT);
    await expect(reply(page)).toBeEnabled();
  }
  await reply(operator.page).fill('We open at 9');
  await reply(operator.page).press('Enter');
  await expect(operator.page.getByTestId('reply-delivery').getByText('Sent')).toBeVisible(WAIT);
  expect(await world.sentMessages(fresh)).toHaveLength(1);

  await owner.context.close();
  await operator.context.close();
});

test('deactivating the operator stops their open inbox and the next action shows the access-removed notice (AC-09)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 734_001, 'Hello there', 'Zoe')).toBe(200);

  const operator = await openInbox(browser, OPERATOR, workspaceId);
  // The owner's open inbox is the control: it proves the next message is published live.
  const owner = await openInbox(browser, OWNER, workspaceId);
  for (const { page } of [operator, owner]) await expect(rows(page)).toHaveCount(1, WAIT);
  await expect.poll(() => operator.sockets.some((ws) => !ws.isClosed()), WAIT).toBe(true);

  const framesBefore = operator.frames.length;
  await world.deactivate(OWNER, workspaceId, OPERATOR);
  // Within 5 s (AC-09) the server ends the operator's live stream (4403) and it is not reopened.
  await expect.poll(() => operator.sockets.every((ws) => ws.isClosed()), WAIT).toBe(true);
  expect(await world.customerWrites(token, 734_002, 'Anyone around?', 'Yan')).toBe(200);

  // The owner gets it live; the operator's open inbox, which would have got it too, does not.
  await expect(rows(owner.page)).toHaveCount(2, WAIT);
  await expect(owner.page.getByText('Anyone around?')).toBeVisible();
  await expect(operator.page.getByText('Anyone around?')).toHaveCount(0);
  await expect(rows(operator.page)).toHaveCount(1);
  expect(operator.frames.slice(framesBefore)).toEqual([]);
  expect(operator.sockets.every((ws) => ws.isClosed())).toBe(true);
  // The next action lands on the notice.
  await rows(operator.page).first().click();
  await expect(operator.page.getByText('Your access to Acme Flowers was removed')).toBeVisible(
    WAIT,
  );
  await expect(operator.page.getByText('Yan')).toHaveCount(0);
  await expect(operator.page.getByText('Zoe')).toHaveCount(0);

  await owner.context.close();
  await operator.context.close();
});
