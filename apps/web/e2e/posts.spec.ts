import type { Browser, Page } from '@playwright/test';
import { expect, PASSWORD, test, type World } from './support/world.ts';

/**
 * The posts flows (AC-01, AC-05, AC-07, AC-09, AC-15) in real browsers against the API, an
 * ephemeral database, the real sending queue and the fake Bot API. The channel is "Acme Flowers
 * News": the bot is its admin (scripted `getChatMember`), the connect code is posted as a
 * `channel_post` update; every wait is on visible text, never on a sleep.
 */

const OWNER = 'boss@example.test';
const OPERATOR = 'ana@example.test';
const WAIT = { timeout: 5_000 };
const SENDING = { timeout: 20_000 };
const CHANNEL = { id: -1001234567890, title: 'Acme Flowers News' };

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'));
}

async function open(browser: Browser, email: string, workspaceId: string, path: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  await page.goto(`/w/${workspaceId}${path}`);
  return { context, page };
}

/** Acme Flowers: an owner (Olga), an operator (Ana), a working bot that may post to the channel. */
async function acme(world: World) {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', OWNER, 'Olga');
  await world.joinOperator(OWNER, workspaceId, OPERATOR, 'Ana');
  const token = world.botToken(690_101n);
  await world.scriptBot(token, {
    chatMembers: {
      [String(CHANNEL.id)]: { status: 'administrator', can_post_messages: true },
    },
  });
  await world.connectBot(OWNER, workspaceId, token);
  return { workspaceId, token };
}

const postRow = (page: Page, text: string) =>
  page
    .getByRole('table', { name: 'Posts' })
    .locator('tbody')
    .getByRole('row')
    .filter({ hasText: text });

/** Opens the draft as the owner, publishes it through the dialog and waits for "Published". */
async function publishFromUi(page: Page, workspaceId: string, postId: string, text: string) {
  await page.goto(`/w/${workspaceId}/posts/${postId}`);
  await page.getByRole('button', { name: 'Publish now' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(`Publish to ${CHANNEL.title} now?`)).toBeVisible(WAIT);
  await expect(dialog.getByText('Channel', { exact: true })).toBeVisible();
  await expect(dialog.getByText(text)).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/Published /)).toBeVisible(SENDING);
}

test('the owner creates a connect code in Settings, posts it in the channel, and the channel appears live (AC-01)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  const { page } = await open(browser, OWNER, workspaceId, '/settings/channels');
  await expect(page.getByRole('heading', { level: 1, name: 'Channels & groups' })).toBeVisible(
    WAIT,
  );

  await page.getByRole('button', { name: 'Connect a channel or group' }).first().click();
  const dialog = page.getByRole('dialog');
  const code = (await dialog.locator('code').first().innerText()).trim();
  expect(code).toMatch(/^tgp_/);

  expect(await world.channelPost(token, CHANNEL, code)).toBe(200);
  await expect(dialog.getByText(`${CHANNEL.title} is connected`)).toBeVisible(SENDING);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(CHANNEL.title, { exact: true })).toBeVisible(WAIT);
  await expect(page.getByText('Channel', { exact: true })).toBeVisible();

  // The code stops working: the second post of it connects nothing new.
  expect(
    await world.channelPost(token, { ...CHANNEL, id: -1009999999999, title: 'Other' }, code),
  ).toBe(200);
  await expect(page.getByText('Other', { exact: true })).toHaveCount(0);
  // The bot removes the code message from the channel.
  await expect
    .poll(async () => (await world.deletedMessages(token)).length, SENDING)
    .toBeGreaterThan(0);
});

test('an operator drafts a post and everyone sees it on the Posts page; the owner publishes it once (AC-05, AC-07)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  await world.connectChannel(OWNER, workspaceId, token, CHANNEL);
  const olga = await open(browser, OWNER, workspaceId, '/posts');
  const ana = await open(browser, OPERATOR, workspaceId, '/posts/new');
  const { page } = ana;

  await page.getByLabel('Destination').click();
  await page.getByRole('option', { name: CHANNEL.title }).click();
  const text = 'New tulips arrived this morning.';
  await page.getByLabel('Text').fill(text);
  await page.getByLabel('Send without sound').click();
  await expect(
    page.getByText(`${(4096 - text.length).toLocaleString('en-US')} characters left`),
  ).toBeVisible(WAIT);
  await expect(page.getByText('Preview')).toBeVisible();
  await expect(page.getByText('Saved')).toBeVisible(WAIT);
  await expect(page.getByRole('button', { name: 'Publish now' })).toHaveCount(0); // owner action

  for (const p of [olga.page, page]) {
    await p.goto(`/w/${workspaceId}/posts`);
    const row = postRow(p, text);
    await expect(row).toContainText('Draft', WAIT);
    await expect(row).toContainText(CHANNEL.title);
    await expect(row).toContainText('Ana');
  }

  await postRow(olga.page, text).getByRole('link').first().click();
  const postId = new URL(olga.page.url()).pathname.split('/').at(-1)!;
  await publishFromUi(olga.page, workspaceId, postId, text);
  // published by the owner who confirmed it, not the draft's author
  await expect(olga.page.getByText(/Published .* · Olga/)).toBeVisible(WAIT);
  await expect(olga.page.getByRole('button', { name: 'Duplicate' })).toBeVisible();
  await expect
    .poll(async () => (await world.sentMessages(token)).filter((m) => m.text === text).length)
    .toBe(1);
});

test('the owner schedules a draft for tomorrow 09:00 in Europe/Kyiv; every member sees that zone; an operator moves it back (AC-09)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  const destinationId = await world.connectChannel(OWNER, workspaceId, token, CHANNEL);
  await world.setPostingTimeZone(OWNER, workspaceId, 'Europe/Kyiv');
  const text = 'Weekend sale starts at nine.';
  const postId = await world.draftPost(OWNER, workspaceId, text, destinationId);
  const tomorrow = new Date(Date.now() + 36 * 3_600_000).toISOString().slice(0, 10);

  const olga = await open(browser, OWNER, workspaceId, `/posts/${postId}`);
  await olga.page.getByRole('button', { name: 'Schedule…' }).click();
  const dialog = olga.page.getByRole('alertdialog');
  await expect(dialog.getByText('Europe/Kyiv')).toBeVisible(WAIT);
  await dialog.getByLabel('Date').fill(tomorrow);
  await dialog.getByLabel('Time').fill('09:00');
  await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(olga.page.getByText(/Goes out .*09:00 \(Europe\/Kyiv\)/)).toBeVisible(WAIT);

  const ana = await open(browser, OPERATOR, workspaceId, '/posts');
  const row = postRow(ana.page, text);
  await expect(row).toContainText('Scheduled', WAIT);
  await expect(row).toContainText('09:00');
  await row.getByRole('link').first().click();
  await expect(ana.page.getByRole('button', { name: 'Change time' })).toHaveCount(0); // owner action
  await ana.page.getByRole('button', { name: 'Back to draft' }).click();
  await ana.page.getByRole('alertdialog').getByRole('button', { name: 'Move to drafts' }).click();
  await expect(ana.page.getByText('Draft').first()).toBeVisible(WAIT);
  await expect(olga.page.getByText('Draft').first()).toBeVisible(WAIT);
});

test('a scheduled post goes out by itself at its time with no one online (AC-09)', async ({
  world,
}) => {
  test.setTimeout(240_000);
  const { workspaceId, token } = await acme(world);
  const destinationId = await world.connectChannel(OWNER, workspaceId, token, CHANNEL);
  await world.setPostingTimeZone(OWNER, workspaceId, 'Europe/Kyiv');
  const text = 'Good morning from the shop.';
  const postId = await world.draftPost(OWNER, workspaceId, text, destinationId);
  await world.schedulePost(OWNER, workspaceId, postId, 3);
  expect((await world.sentMessages(token)).filter((m) => m.text === text)).toHaveLength(0);
  await expect
    .poll(async () => (await world.sentMessages(token)).filter((m) => m.text === text).length, {
      timeout: 200_000,
      intervals: [2_000],
    })
    .toBe(1);
});

test('the owner deletes a published post from Telegram; its text stays readable (AC-15)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  const destinationId = await world.connectChannel(OWNER, workspaceId, token, CHANNEL);
  const text = 'Oops, wrong price.';
  const postId = await world.draftPost(OWNER, workspaceId, text, destinationId);
  const { page } = await open(browser, OWNER, workspaceId, '/posts');
  await publishFromUi(page, workspaceId, postId, text);

  await page.getByRole('button', { name: 'Delete from Telegram' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(`Delete this post from ${CHANNEL.title}?`)).toBeVisible(WAIT);
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(/Deleted from Telegram by Olga/)).toBeVisible(WAIT);
  await expect(page.getByText(text).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete from Telegram' })).toHaveCount(0);
});

test('an operator sees no owner actions on a published post (edge case)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  const destinationId = await world.connectChannel(OWNER, workspaceId, token, CHANNEL);
  const text = 'Visible to the whole team.';
  const postId = await world.draftPost(OWNER, workspaceId, text, destinationId);
  const olga = await open(browser, OWNER, workspaceId, '/posts');
  await publishFromUi(olga.page, workspaceId, postId, text);
  const ana = await open(browser, OPERATOR, workspaceId, `/posts/${postId}`);
  await expect(ana.page.getByText(/Published /)).toBeVisible(WAIT);
  await expect(ana.page.getByRole('button', { name: 'Delete from Telegram' })).toHaveCount(0);
  await expect(ana.page.getByRole('button', { name: 'Duplicate' })).toBeVisible();
});
