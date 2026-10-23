import type { Browser, Page } from '@playwright/test';
import { expect, PASSWORD, test, type World } from './support/world.ts';

/**
 * The contacts flows (AC-01, AC-02, AC-05, AC-06, AC-09, AC-11) in real browsers against the API,
 * an ephemeral database and the fake Bot API. Contacts are captured through the webhook and tags
 * seeded over HTTP, never through the UI under test; every wait is on visible text (5 s ceiling,
 * the 3 s live target).
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

async function open(browser: Browser, email: string, workspaceId: string, path: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  await page.goto(`/w/${workspaceId}${path}`);
  return { context, page };
}

/** Acme Flowers: an owner (Olga), an operator (Ana) and a connected bot. */
async function acme(world: World) {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', OWNER, 'Olga');
  await world.joinOperator(OWNER, workspaceId, OPERATOR, 'Ana');
  const token = world.botToken(680_001n);
  await world.scriptBot(token, {});
  await world.connectBot(OWNER, workspaceId, token);
  return { workspaceId, token };
}

/** The Contacts table's body rows (the header row left out). */
const contactRows = (page: Page) =>
  page.getByRole('table', { name: 'Contacts' }).locator('tbody').getByRole('row');
const conversationRows = (page: Page) =>
  page.getByRole('list', { name: 'Conversations' }).getByRole('listitem');
const bubble = (page: Page, text: string) => page.getByTestId('bubble').getByText(text);
const tagsRow = (page: Page) => page.getByTestId('header-tags');
const nav = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });

test('the Contacts list: newest first, Show more, search, any / all / no tags, reload, back and a saved link with a deleted tag (AC-01, AC-02)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  await world.customersWrite(token, 55, 780_000, 'Customer');
  const vip = await world.tagContact(OWNER, workspaceId, 'Customer01', 'VIP');
  const kyiv = await world.tagContact(OWNER, workspaceId, 'Customer02', 'Kyiv');
  await world.tagContact(OWNER, workspaceId, 'Customer02', 'VIP');
  await world.tagContact(OWNER, workspaceId, 'Customer03', 'Kyiv');
  const promo = await world.tagContact(OWNER, workspaceId, 'Customer04', 'Old promo');

  const olga = await open(browser, OWNER, workspaceId, '/contacts');
  const { page } = olga;
  await expect(page.getByText('55 contacts')).toBeVisible(WAIT);
  await expect(contactRows(page)).toHaveCount(50, WAIT);
  await expect(contactRows(page).first()).toContainText('Customer55');
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(contactRows(page)).toHaveCount(55, WAIT);
  await expect(contactRows(page).last()).toContainText('Customer01');
  await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);

  // Search by name: the matching count against the total.
  await page.getByLabel('Search by name or username').fill('customer02');
  await expect(page.getByText('1 of 55 contacts match')).toBeVisible(WAIT);
  await expect(contactRows(page)).toHaveCount(1);
  await expect(contactRows(page).first()).toContainText('Customer02');
  await expect(contactRows(page).first()).toContainText('Kyiv');
  await page.getByLabel('Search by name or username').fill('');
  await expect(page.getByText('55 contacts', { exact: true })).toBeVisible(WAIT);

  // Any of VIP → 2; all of VIP and Kyiv → 1; no tags → the rest.
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByRole('checkbox', { name: /VIP/ }).click();
  await expect(page.getByText('2 of 55 contacts match')).toBeVisible(WAIT);
  await expect(page).toHaveURL(new RegExp(`tag=${vip}`));
  await page.getByRole('radio', { name: 'All of these tags' }).click();
  await page.getByRole('checkbox', { name: /Kyiv/ }).click();
  await expect(page.getByText('1 of 55 contacts match')).toBeVisible(WAIT);
  await expect(contactRows(page).first()).toContainText('Customer02');
  await page.keyboard.press('Escape');

  // The address keeps the view: a reload shows the same, back walks to the previous one.
  await page.reload();
  await expect(page.getByText('1 of 55 contacts match')).toBeVisible(WAIT);
  await expect(page.getByRole('button', { name: 'All of 2 tags' })).toBeVisible();
  await page.goBack();
  await expect(page.getByText('2 of 55 contacts match')).toBeVisible(WAIT);
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual([vip]);

  await page.getByRole('button', { name: 'All of 1 tag' }).click();
  await page.getByRole('radio', { name: 'No tags' }).click();
  await expect(page.getByText('51 of 55 contacts match')).toBeVisible(WAIT);
  await page.keyboard.press('Escape');

  // A saved link to a tag deleted since: the tag is dropped and the page says so.
  await world.deleteTag(OWNER, workspaceId, promo);
  await page.goto(`/w/${workspaceId}/contacts?tag=${promo}&tag=${kyiv}`);
  await expect(
    page.getByText('One of the chosen tags no longer exists, so it was left out of the filter.'),
  ).toBeVisible(WAIT);
  await expect(page.getByText('2 of 55 contacts match')).toBeVisible(WAIT);
  await expect.poll(() => new URL(page.url()).searchParams.getAll('tag'), WAIT).toEqual([kyiv]);

  await olga.context.close();
});

test('reading a conversation on the profile leaves it unread until Open in inbox (AC-05)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 781_001, 'Do you deliver today?', 'Zoe')).toBe(200);
  expect(await world.customerWrites(token, 781_001, 'And on Sunday?', 'Zoe')).toBe(200);

  const ana = await open(browser, OPERATOR, workspaceId, '/contacts');
  const { page } = ana;
  // The attention count before the profile: Zoe's conversation needs Ana.
  await expect(page).toHaveTitle('(1) tg-inbox', WAIT);
  await expect(nav(page).getByLabel('1 conversation needs you')).toBeVisible(WAIT);
  await contactRows(page).filter({ hasText: 'Zoe' }).getByRole('link', { name: 'Zoe' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Zoe' })).toBeVisible(WAIT);
  await expect(bubble(page, 'Do you deliver today?')).toBeVisible(WAIT);
  await expect(bubble(page, 'And on Sunday?')).toBeVisible();
  // The profile has no composer and marks nothing read: the attention count is unchanged.
  await expect(page.getByRole('textbox', { name: 'Reply' })).toHaveCount(0);
  await expect(page).toHaveTitle('(1) tg-inbox');
  await expect(nav(page).getByLabel('1 conversation needs you')).toBeVisible();
  // A message arriving while the profile is open shows live, still unread and still counted.
  expect(await world.customerWrites(token, 781_001, 'Hello?', 'Zoe')).toBe(200);
  await expect(bubble(page, 'Hello?')).toBeVisible(WAIT);
  await expect(page).toHaveTitle('(1) tg-inbox');
  await expect(nav(page).getByLabel('1 conversation needs you')).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: /Inbox/ })
    .click();
  const zoe = conversationRows(page).filter({ hasText: 'Zoe' });
  await expect(zoe.getByLabel('3 unread')).toBeVisible(WAIT);

  // Open in inbox opens the thread, which marks read as before.
  await page.goBack();
  await page.getByRole('link', { name: 'Open in inbox' }).click();
  await expect(page.getByRole('textbox', { name: 'Reply' })).toBeVisible(WAIT);
  await expect(zoe.getByLabel(/unread/)).toHaveCount(0, WAIT);
  await expect(page).toHaveTitle('tg-inbox', WAIT);

  await ana.context.close();
});

test("tagging from the inbox header shows live on a teammate's open profile, with the history (AC-06)", async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 782_001, 'Hi, I order every week', 'Zoe')).toBe(200);
  await world.tagContact(OWNER, workspaceId, 'Zoe', 'Wholesale');
  const zoeId = await world.contactId(OWNER, workspaceId, 'Zoe');

  const olga = await open(browser, OWNER, workspaceId, `/contacts/${zoeId}`);
  await expect(olga.page.getByRole('heading', { level: 1, name: 'Zoe' })).toBeVisible(WAIT);

  const conversationId = await world.conversationId(OPERATOR, workspaceId, 'Zoe');
  const ana = await open(browser, OPERATOR, workspaceId, `/inbox/${conversationId}`);
  await expect(tagsRow(ana.page).getByText('Wholesale')).toBeVisible(WAIT);
  await ana.page.getByRole('textbox', { name: 'Reply' }).fill('half a reply');

  // Ana creates «Kyiv» in the tag control and removes «Wholesale».
  await tagsRow(ana.page).getByRole('button', { name: 'Add tag' }).click();
  const control = ana.page.getByRole('dialog', { name: 'Tags' });
  await expect(
    control.getByText(
      "Tags are visible to your whole team. Don't use them for health, religion or other sensitive traits.",
    ),
  ).toBeVisible();
  await control.getByRole('combobox').fill('Kyiv');
  await control.getByRole('option', { name: 'Create tag "Kyiv"' }).click();
  await expect(control.getByRole('button', { name: 'Remove tag Kyiv' })).toBeVisible(WAIT);
  await expect(control.getByRole('combobox')).toHaveValue('');
  await control.getByRole('combobox').fill(' kyiv ');
  await expect(control.getByRole('option')).toHaveCount(1);
  await expect(control.getByRole('option', { name: /Kyiv.*On this contact/ })).toBeDisabled();
  await control.getByRole('button', { name: 'Remove tag Wholesale' }).click();
  await expect(control.getByRole('button', { name: 'Remove tag Wholesale' })).toHaveCount(0, WAIT);
  await ana.page.keyboard.press('Escape');
  await expect(control).toHaveCount(0);
  await expect(tagsRow(ana.page).getByText('Kyiv')).toBeVisible();
  await expect(ana.page.getByRole('textbox', { name: 'Reply' })).toHaveValue('half a reply');

  // Olga's open profile follows without reloading, history included.
  const header = olga.page.getByRole('heading', { level: 1, name: 'Zoe' }).locator('..');
  await expect(header.getByText('Kyiv', { exact: true })).toBeVisible(WAIT);
  await expect(header.getByText('Wholesale', { exact: true })).toHaveCount(0, WAIT);
  await olga.page.getByRole('tab', { name: 'Tag history' }).click();
  await expect(olga.page.getByText(/Ana added «Kyiv» · inbox/)).toBeVisible(WAIT);
  await expect(olga.page.getByText(/Ana removed «Wholesale» · inbox/)).toBeVisible(WAIT);

  // Nothing of it reached the customer.
  expect(await world.sentMessages(token)).toHaveLength(0);

  await olga.context.close();
  await ana.context.close();
});

test('an owner renames, merges and deletes tags in Settings — Tags, with the history entries (AC-09)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  for (const [n, name] of ['Zoe', 'Yan', 'Max', 'Ivy'].entries())
    expect(await world.customerWrites(token, 783_001 + n, `Hi from ${name}`, name)).toBe(200);
  await world.tagContact(OWNER, workspaceId, 'Zoe', 'vip-clients');
  await world.tagContact(OWNER, workspaceId, 'Zoe', 'VIP');
  await world.tagContact(OWNER, workspaceId, 'Yan', 'vip-clients');
  await world.tagContact(OWNER, workspaceId, 'Max', 'Old promo');

  const olga = await open(browser, OWNER, workspaceId, '/settings/tags');
  const { page } = olga;
  const row = (name: string) =>
    page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
  await expect(row('vip-clients')).toContainText('2 contacts', WAIT);
  await expect(row('VIP')).toContainText('1 contact');

  // Rename vip-clients → Loyal.
  await row('vip-clients').getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Loyal');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(row('Loyal')).toContainText('2 contacts', WAIT);
  await expect(row('vip-clients')).toHaveCount(0);

  // Rename Loyal → vip: the merge offer, then the merge.
  await row('Loyal').getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('vip');
  await page.getByRole('button', { name: 'Save' }).click();
  const merge = page.getByRole('dialog', { name: 'Merge into «VIP»?' });
  await expect(merge).toContainText('already exists (1 contact)', WAIT);
  await expect(merge).toContainText('moves the 2 contacts of «Loyal»');
  await merge.getByRole('button', { name: 'Merge tags' }).click();
  await expect(page.getByText('«Loyal» merged into «VIP».')).toBeVisible(WAIT);
  await expect(row('Loyal')).toHaveCount(0);
  await expect(row('VIP')).toContainText('2 contacts', WAIT);

  // Delete Old promo: the count changes before the confirm, so it asks again with the new number.
  await row('Old promo').getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete «Old promo»?' });
  await expect(confirm).toContainText('It will be removed from 1 contact.', WAIT);
  await world.tagContact(OPERATOR, workspaceId, 'Ivy', 'Old promo');
  await confirm.getByRole('button', { name: 'Delete tag' }).click();
  await expect(confirm).toContainText('It will be removed from 2 contacts.', WAIT);
  await expect(confirm).toContainText('The number of contacts changed since you opened this.');
  await confirm.getByRole('button', { name: 'Delete tag' }).click();
  await expect(page.getByText('«Old promo» deleted.')).toBeVisible(WAIT);
  await expect(row('Old promo')).toHaveCount(0);

  // The count link opens the list filtered by the tag, with the same number.
  await row('VIP').getByRole('link', { name: '2 contacts' }).click();
  await expect(page.getByText('2 of 4 contacts match')).toBeVisible(WAIT);

  // The history of the affected contacts records the merge and the delete.
  const history = async (firstName: string) => {
    await page.goto(
      `/w/${workspaceId}/contacts/${await world.contactId(OWNER, workspaceId, firstName)}`,
    );
    await page.getByRole('tab', { name: 'Tag history' }).click();
  };
  await history('Yan');
  await expect(page.getByText(/Olga merged «Loyal» into «VIP»/)).toBeVisible(WAIT);
  await history('Max');
  await expect(page.getByText(/«Old promo» removed by Olga's delete/)).toBeVisible(WAIT);

  await olga.context.close();
});

test('an operator sees no Tags section and gets the owners-only card on its address (AC-11)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 784_001, 'Hello', 'Zoe')).toBe(200);
  await world.tagContact(OWNER, workspaceId, 'Zoe', 'VIP');

  const ana = await open(browser, OPERATOR, workspaceId, '/settings');
  const { page } = ana;
  await expect(page).toHaveURL(/\/settings\/notifications$/, WAIT);
  const settingsNav = page.getByRole('navigation', { name: 'Settings' });
  await expect(settingsNav.getByRole('link', { name: 'Notifications' })).toBeVisible();
  await expect(settingsNav.getByRole('link', { name: 'Tags' })).toHaveCount(0);

  await page.goto(`/w/${workspaceId}/settings/tags`);
  await expect(page.getByText("Only a business owner manages the workspace's tags")).toBeVisible(
    WAIT,
  );
  await expect(page.getByRole('button', { name: 'Rename' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to inbox' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/inbox`), WAIT);

  await ana.context.close();
});
