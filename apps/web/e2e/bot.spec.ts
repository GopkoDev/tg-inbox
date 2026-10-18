import type { Page } from '@playwright/test';
import { expect, PASSWORD, test, type World } from './support/world.ts';

/**
 * The seven bot-settings flows (test-plan §E2E-through-UI scope) in a real browser against the
 * API, an ephemeral database and the fake Bot API. Customer messages are posted to the webhook by
 * the test; revoke and takeover are scripted on the fake and the health check is run, not waited for.
 */

const OWNER = 'boss@example.test';
const OTHER_SERVICE = 'https://other-service.example/hook';
const NOT_VALID = 'The token is not valid — copy it again from BotFather';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'));
}

/** SCR-01 → SCR-02 through the owner-only Bot entry. */
async function openBot(page: Page, workspaceId: string) {
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/settings/bot$`));
  await expect(page.getByRole('heading', { name: 'Bot' })).toBeVisible();
}

async function pasteToken(page: Page, opener: string, token: string, submit: string) {
  await page.getByRole('button', { name: opener }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Bot token').fill(token);
  await dialog.getByRole('button', { name: submit }).click();
}

const facts = (page: Page) => page.getByTestId('bot-facts');
/** The identity getMe answers for the connected bot (a re-script replaces the whole script). */
const ME = { first_name: 'Acme Flowers Support', username: 'acme_support_bot' };

/** An owner with a connected bot, on SCR-02. */
async function connectedOwner(page: Page, world: World) {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', OWNER);
  const telegramBotId = 610_001n;
  const token = world.botToken(telegramBotId);
  await world.scriptBot(token, { me: ME });
  await signIn(page, OWNER);
  await openBot(page, workspaceId);
  await pasteToken(page, 'Connect bot', token, 'Connect');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  return { workspaceId, token, telegramBotId };
}

test('connect a clean bot; a customer message shows up after reload (AC-01, AC-07, AC-15)', async ({
  page,
  world,
}) => {
  const { token } = await connectedOwner(page, world);
  await expect(page.getByText('Acme Flowers Support')).toBeVisible();
  await expect(page.getByRole('link', { name: '@acme_support_bot' })).toBeVisible();
  await expect(page.getByText('Write to @acme_support_bot in Telegram to test')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(token);

  expect(await world.customerWrites(token, 720001, 'Do you deliver today?')).toBe(200);
  await page.reload();
  await expect(facts(page).getByText('none yet')).toHaveCount(0);
  await expect(facts(page).getByText('1', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Do you deliver today?');
});

test('paste an invalid token, see the error, then a valid one (AC-02)', async ({ page, world }) => {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', OWNER);
  const token = world.botToken();
  await world.scriptBot(token, {});
  await signIn(page, OWNER);
  await openBot(page, workspaceId);

  await pasteToken(page, 'Connect bot', '123:not-really-a-token', 'Connect');
  const dialog = page.getByRole('dialog', { name: 'Connect bot' });
  await expect(dialog.getByRole('alert')).toHaveText(NOT_VALID);
  await expect(dialog.getByLabel('Bot token')).toHaveValue('');

  await dialog.getByLabel('Bot token').fill(token);
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
});

test('a bot delivering to another service: cancel once, then confirm (AC-06)', async ({
  page,
  world,
}) => {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', OWNER);
  const token = world.botToken(610_002n);
  await world.scriptBot(token, { webhookUrl: OTHER_SERVICE });
  await signIn(page, OWNER);
  await openBot(page, workspaceId);

  await pasteToken(page, 'Connect bot', token, 'Connect');
  const warning = page.getByRole('alertdialog', { name: 'Take over @test_bot_610002?' });
  await expect(warning).toContainText(
    'Connecting will stop this bot delivering messages to another service',
  );
  await warning.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText('No bot is connected')).toBeVisible();

  await pasteToken(page, 'Connect bot', token, 'Connect');
  await page
    .getByRole('alertdialog', { name: 'Take over @test_bot_610002?' })
    .getByRole('button', { name: 'Connect' })
    .click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
});

test('revoked bot → needs a new token → paste a new token → connected (AC-16, AC-17)', async ({
  page,
  world,
}) => {
  const { token, telegramBotId } = await connectedOwner(page, world);
  expect(await world.customerWrites(token, 720002, 'Hello')).toBe(200);

  await world.scriptBot(token, { me: ME, getMe: 'unauthorized' });
  await world.healthTick();
  await page.reload();
  await expect(page.getByText('Not working — needs a new token')).toBeVisible();
  await expect(facts(page).getByText('1', { exact: true })).toBeVisible();

  const fresh = world.botToken(telegramBotId);
  await world.scriptBot(fresh, { me: ME });
  await pasteToken(page, 'Paste new token', fresh, 'Save token');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  expect(await world.customerWrites(fresh, 720002, 'Still there?')).toBe(200);
});

test('bot taken over → reconnect → confirm → connected (AC-16b)', async ({ page, world }) => {
  const { token } = await connectedOwner(page, world);

  await world.scriptBot(token, { me: ME, webhookUrl: OTHER_SERVICE });
  await world.healthTick();
  await page.reload();
  await expect(page.getByText('Not receiving messages')).toBeVisible();

  await page.getByRole('button', { name: 'Reconnect' }).click();
  const warning = page.getByRole('alertdialog', { name: 'Take over @acme_support_bot?' });
  await warning.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  expect(await world.customerWrites(token, 720003, 'Back?')).toBe(200);
});

test('disconnect with confirmation (AC-18)', async ({ page, world }) => {
  const { token } = await connectedOwner(page, world);
  expect(await world.customerWrites(token, 720004, 'Hi')).toBe(200);

  await page.getByRole('button', { name: 'Disconnect' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Disconnect @acme_support_bot?' });
  await expect(confirm).toContainText('Contacts and conversations captured so far stay.');
  await confirm.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText('No bot is connected')).toBeVisible();
  // Messages sent from now on never reach tg-inbox.
  expect(await world.customerWrites(token, 720004, 'Anyone?')).toBe(401);
});

test('an operator sees no Bot entry and the owners-only page at the Bot address (AC-03)', async ({
  page,
  world,
}) => {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', OWNER);
  await world.joinOperator(OWNER, workspaceId, 'ana@example.test', 'Ana');
  await signIn(page, 'ana@example.test');
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/inbox$`));
  await expect(
    page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Settings' }),
  ).toHaveCount(0);

  await page.goto(`/w/${workspaceId}/bot`);
  await expect(page.getByText('Only business owners manage the bot')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect bot' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/inbox$`));
});
