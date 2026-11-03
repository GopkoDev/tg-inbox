import type { Browser, Page } from '@playwright/test';
import { sendAnswers } from '../../api/src/test/fake-telegram.ts';
import { expect, PASSWORD, test, type World } from './support/world.ts';

/**
 * The broadcasts flows (AC-01, AC-04, AC-06, AC-07, AC-11, AC-14, AC-16, AC-18) in real browsers
 * against the API, an ephemeral database, the real sending queue and the fake Bot API. Contacts
 * are captured through the webhook, tags and seeded drafts go over HTTP, a block is a
 * `my_chat_member` update posted as Telegram; every wait is on visible text, never on a sleep.
 */

const OWNER = 'boss@example.test';
const OPERATOR = 'ana@example.test';
const WAIT = { timeout: 5_000 };
/** A broadcast's outcomes arrive through the queue (fake sends held for seconds). */
const SENDING = { timeout: 20_000 };

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

/** Acme Flowers: an owner (Olga), an operator (Ana) and a connected, working bot. */
async function acme(world: World) {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', OWNER, 'Olga');
  await world.joinOperator(OWNER, workspaceId, OPERATOR, 'Ana');
  const token = world.botToken(690_001n);
  await world.scriptBot(token, {});
  await world.connectBot(OWNER, workspaceId, token);
  return { workspaceId, token };
}

const broadcastRows = (page: Page) =>
  page.getByRole('table', { name: 'Broadcasts' }).locator('tbody').getByRole('row');
const broadcastRow = (page: Page, name: string) =>
  broadcastRows(page).filter({ has: page.getByRole('link', { name, exact: true }) });
const contactRows = (page: Page) =>
  page.getByRole('table', { name: 'Contacts' }).locator('tbody').getByRole('row');
const conversationRows = (page: Page) =>
  page.getByRole('list', { name: 'Conversations' }).getByRole('listitem');
/** One line of the count breakdown (SCR-25 / SCR-27 / SCR-28), found by its label. */
const breakdownLine = (scope: Page | ReturnType<Page['getByRole']>, label: string) =>
  scope.getByLabel('Count breakdown').locator('[data-line]').filter({ hasText: label });
const launchedView = (page: Page) => page.getByTestId('broadcast-launched-view');
const statusBadge = (page: Page, status: string) =>
  launchedView(page).locator('[data-slot="badge"]', { hasText: status }).first();
const total = (page: Page, label: string) =>
  page.getByTestId('broadcast-report').locator('[data-total]').filter({ hasText: label });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });

test('an operator drafts a tag audience with its breakdown; no Launch, the /launch link lands on the draft, the list shows it to the team (AC-01, AC-07)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  // Customer01–06 (Telegram ids 790 001–790 006): VIP on 01–04, Staff on 04–05, Kyiv on 06.
  await world.customersWrite(token, 6, 790_000, 'Customer');
  for (const n of ['01', '02', '03', '04'])
    await world.tagContact(OWNER, workspaceId, `Customer${n}`, 'VIP');
  for (const n of ['04', '05']) await world.tagContact(OWNER, workspaceId, `Customer${n}`, 'Staff');
  await world.tagContact(OWNER, workspaceId, 'Customer06', 'Kyiv');
  await world.customerBlocksBot(token, 790_002); // Customer02 blocked the bot
  // A draft of Olga's: Ana may edit it, not delete it.
  const olgasDraft = await world.draftBroadcast(
    OWNER,
    workspaceId,
    'Opening hours',
    'We open at 9',
  );

  const olga = await open(browser, OWNER, workspaceId, '/broadcasts');
  await expect(broadcastRow(olga.page, 'Opening hours')).toBeVisible(WAIT);

  const ana = await open(browser, OPERATOR, workspaceId, '/broadcasts');
  const { page } = ana;
  await nav(page)
    .getByRole('link', { name: /Broadcasts/ })
    .click();
  await page.getByRole('link', { name: 'New broadcast' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New broadcast' })).toBeVisible(WAIT);
  await expect(page.getByText('Name the broadcast to start')).toBeVisible();

  // The first valid name creates the draft; the address becomes its own.
  await page.getByLabel('Name').fill('Spring prices');
  await expect(page).toHaveURL(new RegExp(`/broadcasts/[0-9a-f-]{36}$`), WAIT);
  const draftId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByRole('heading', { level: 1, name: 'Spring prices' })).toBeVisible(WAIT);
  const text = 'Spring prices are here: tulips 20% off until Sunday.';
  await page.getByLabel('Text').fill(text);
  await expect(
    page.getByText(`${(4096 - text.length).toLocaleString('en-US')} characters left`),
  ).toBeVisible();

  // Send to any of VIP, leave out Staff (the text field's blur saves the text first).
  await page.getByRole('button', { name: 'Send to', exact: true }).click();
  await page.getByRole('checkbox', { name: /VIP/ }).click();
  await page.getByRole('button', { name: 'Send to · Any of 1' }).click(); // closes it
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Leave out', exact: true }).click();
  await page.getByRole('checkbox', { name: /Staff/ }).click();
  await page.getByRole('button', { name: 'Leave out · 1' }).click(); // closes it
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  const badges = page.getByTestId('audience-badges');
  await expect(badges.getByText('VIP', { exact: true })).toBeVisible();
  await expect(badges.getByText('− Staff', { exact: true })).toBeVisible();

  // VIP is on 4, Customer04 also carries Staff → 3; Customer02 blocked the bot → reaches 2.
  await expect(breakdownLine(page, 'Audience')).toContainText('3 contacts', WAIT);
  await expect(breakdownLine(page, 'Left out — blocked the bot')).toContainText('1');
  await expect(breakdownLine(page, 'Left out — never wrote to the current bot')).toContainText('0');
  await expect(breakdownLine(page, 'Would reach')).toContainText('2');

  // An operator: no Launch, the owners-only note; a saved /launch link lands on the draft.
  await expect(page.getByText('Only a business owner launches broadcasts.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Launch' })).toHaveCount(0);
  await expect(page.getByText('Saved')).toBeVisible(WAIT);
  await page.goto(`/w/${workspaceId}/broadcasts/${draftId}/launch`);
  await expect(page).toHaveURL(new RegExp(`/broadcasts/${draftId}$`), WAIT);
  await expect(page.getByText('Only a business owner launches broadcasts.')).toBeVisible(WAIT);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Launch' })).toHaveCount(0);

  // Leave the page: the list shows the draft, its audience and who changed it — live for Olga too.
  await nav(page)
    .getByRole('link', { name: /Broadcasts/ })
    .click();
  for (const p of [page, olga.page]) {
    const row = broadcastRow(p, 'Spring prices');
    await expect(row).toContainText('Draft', WAIT);
    await expect(row).toContainText('3 contacts', WAIT);
    await expect(row).toContainText('Ana ·');
  }

  // Reopening shows the same text and audience with the count as it is now.
  await broadcastRow(page, 'Spring prices').getByRole('link', { name: 'Spring prices' }).click();
  await expect(page.getByLabel('Text')).toHaveValue(text, WAIT);
  await expect(page.getByLabel('Name')).toHaveValue('Spring prices');
  await expect(badges.getByText('− Staff', { exact: true })).toBeVisible(WAIT);
  await expect(breakdownLine(page, 'Would reach')).toContainText('2', WAIT);

  // A teammate's draft: Ana edits it but cannot delete it.
  await page.goto(`/w/${workspaceId}/broadcasts/${olgasDraft}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Opening hours' })).toBeVisible(WAIT);
  await page.getByRole('button', { name: 'More' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'A draft is deleted by its author or a business owner' }),
  ).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Nothing reached any customer.
  expect(await world.sentMessages(token)).toHaveLength(0);

  await olga.context.close();
  await ana.context.close();
});

test('an operator builds a hand-picked group: search and Add, Add all matching with its count, the blocked marker, Remove (AC-04)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 791_001, 'Hi, Olena here', 'Olena')).toBe(200);
  // Customer01–05 (791 101–791 105): Wholesale on 01–04; Customer03 blocked the bot.
  await world.customersWrite(token, 5, 791_100, 'Customer');
  for (const n of ['01', '02', '03', '04'])
    await world.tagContact(OWNER, workspaceId, `Customer${n}`, 'Wholesale');
  await world.customerBlocksBot(token, 791_103);

  const ana = await open(browser, OPERATOR, workspaceId, '/broadcasts/new');
  const { page } = ana;
  await page.getByLabel('Name').fill('Wholesale catch-up');
  await expect(page).toHaveURL(new RegExp(`/broadcasts/[0-9a-f-]{36}$`), WAIT);
  await page.getByLabel('Hand-picked group').click();
  await expect(page.getByText('No contacts in this group yet.')).toBeVisible(WAIT);

  await page.getByRole('button', { name: 'Add contacts' }).click();
  const picker = page.getByRole('dialog', { name: 'Add contacts' });
  await expect(picker.getByText('6 contacts', { exact: true })).toBeVisible(WAIT);
  const search = picker.getByLabel('Search by name or username');
  const pickerRow = (name: string) =>
    picker.getByRole('list', { name: 'Contacts' }).getByRole('listitem').filter({ hasText: name });

  // Search by name and Add, one by one.
  await search.fill('customer01');
  await expect(picker.getByText('1 of 6 contacts match')).toBeVisible(WAIT);
  await picker.getByRole('button', { name: 'Add Customer01' }).click();
  await expect(pickerRow('Customer01')).toContainText('In group ✓', WAIT);
  await search.fill('olena');
  await expect(picker.getByText('1 of 6 contacts match')).toBeVisible(WAIT);
  await picker.getByRole('button', { name: 'Add Olena' }).click();
  await expect(pickerRow('Olena')).toContainText('In group ✓', WAIT);

  // Filter by Wholesale with the search «customer»: 4 match, 1 already in → Add all matching (3).
  await search.fill('customer');
  await picker.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByRole('checkbox', { name: /Wholesale/ }).click();
  await picker.getByRole('button', { name: 'Tags · 1' }).click(); // closes the tag popover
  await expect(picker.getByText('4 of 6 contacts match')).toBeVisible(WAIT);
  await expect(pickerRow('Customer03')).toContainText('Blocked the bot');
  await picker.getByRole('button', { name: 'Add all matching (3)' }).click();
  await expect(picker.getByText('Add 3 contacts to this group?')).toBeVisible();
  await picker.getByRole('button', { name: 'Add 3', exact: true }).click();
  await expect(picker.getByText('3 contacts added.')).toBeVisible(WAIT);
  for (const n of ['01', '02', '03', '04'])
    await expect(pickerRow(`Customer${n}`)).toContainText('In group ✓', WAIT);
  await picker.getByRole('button', { name: 'Done' }).click();
  await expect(picker).toHaveCount(0);

  // The group: 5 contacts with tags, the blocked marker, and what it would reach.
  const group = page.getByRole('table', { name: 'Hand-picked group' });
  const groupRow = (name: string) =>
    group.locator('tbody').getByRole('row').filter({ hasText: name });
  const groupSize = page.locator('p', { hasText: /^\d+ contacts?$/ });
  await expect(groupSize).toHaveText('5 contacts', WAIT);
  await expect(group.locator('tbody').getByRole('row')).toHaveCount(5, WAIT);
  await expect(groupRow('Customer03')).toContainText('Blocked the bot');
  await expect(groupRow('Customer02')).toContainText('Wholesale');
  await expect(groupRow('Olena')).not.toContainText('Blocked the bot');
  await expect(breakdownLine(page, 'Audience')).toContainText('5 contacts', WAIT);
  await expect(breakdownLine(page, 'Left out — blocked the bot')).toContainText('1');
  await expect(breakdownLine(page, 'Would reach')).toContainText('4');

  // Remove takes the contact out of this draft only.
  await page.getByRole('button', { name: 'Remove Customer02 from this group' }).click();
  await expect(groupSize).toHaveText('4 contacts', WAIT);
  await expect(groupRow('Customer02')).toHaveCount(0, WAIT);
  await expect(breakdownLine(page, 'Would reach')).toContainText('3', WAIT);
  await page.goto(`/w/${workspaceId}/contacts?q=customer02`);
  await expect(contactRows(page)).toHaveCount(1, WAIT);
  await expect(contactRows(page).first()).toContainText('Wholesale');

  expect(await world.sentMessages(token)).toHaveLength(0);
  await ana.context.close();
});

test('an owner launches from the confirmation and follows the report to Sent live; the thread shows the broadcast item and unread does not move (AC-06, AC-11, AC-16)', async ({
  browser,
  world,
}) => {
  test.setTimeout(60_000);
  const { workspaceId, token } = await acme(world);
  const people = [
    ['Zoe', 792_001],
    ['Yan', 792_002],
    ['Max', 792_003],
    ['Ivy', 792_004],
  ] as const;
  for (const [name, id] of people)
    expect(await world.customerWrites(token, id, `Hello from ${name}`, name)).toBe(200);
  const vip = await world.tagContact(OWNER, workspaceId, 'Zoe', 'VIP');
  for (const name of ['Yan', 'Max', 'Ivy']) await world.tagContact(OWNER, workspaceId, name, 'VIP');
  await world.customerBlocksBot(token, 792_004); // Ivy is left out
  await world.close(OWNER, workspaceId, 'Zoe'); // closed, unassigned, unread for Ana
  const text = 'Spring prices: tulips 20% off.\nSee you this week!';
  const draftId = await world.draftBroadcast(OWNER, workspaceId, 'Spring prices', text, {
    tagIds: [vip],
  });
  // Each send is held 3 s at the fake, so the report is seen sending before it ends.
  await world.scriptBot(token, {
    sendMessage: [sendAnswers.hang(3_000), sendAnswers.hang(3_000), sendAnswers.hang(3_000)],
  });

  // Ana watches the list; her inbox's closed lens shows Zoe with 1 unread.
  const ana = await open(browser, OPERATOR, workspaceId, '/inbox?status=closed');
  const zoe = conversationRows(ana.page).filter({ hasText: 'Zoe' });
  await expect(zoe.getByLabel('1 unread')).toBeVisible(WAIT);
  await ana.page.goto(`/w/${workspaceId}/broadcasts`);
  await expect(broadcastRow(ana.page, 'Spring prices')).toContainText('Draft', WAIT);

  // Olga: Launch → the confirmation (exact text, the number, who is left out, the warning).
  const olga = await open(browser, OWNER, workspaceId, `/broadcasts/${draftId}`);
  const { page } = olga;
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page).toHaveURL(new RegExp(`/broadcasts/${draftId}/launch$`), WAIT);
  const confirm = page.getByRole('alertdialog', { name: 'Send this broadcast?' });
  await expect(confirm).toContainText(
    'This message goes to 3 contacts from your business bot',
    WAIT,
  );
  await expect(confirm.getByTestId('launch-text')).toHaveText(text);
  await expect(breakdownLine(confirm, 'Left out — blocked the bot')).toContainText('1');
  await expect(breakdownLine(confirm, 'Would reach')).toContainText('3');
  await expect(confirm).toContainText(
    'Customers who did not expect this message can block or report the bot. That can limit the bot for support too.',
  );
  await confirm.getByRole('button', { name: 'Send to 3 contacts' }).click();
  await expect(confirm).toHaveCount(0, WAIT);

  // The report: Sending, then Sent with the final totals, without a reload; no notice after the
  // owner's own launch (SCR-28).
  await expect(page).toHaveURL(new RegExp(`/broadcasts/${draftId}$`), WAIT);
  await expect(statusBadge(page, 'Sending')).toBeVisible(WAIT);
  await expect(
    page.getByText('This broadcast was launched and can no longer be changed.'),
  ).toHaveCount(0);
  await expect(page.getByText('A teammate launched this broadcast.')).toHaveCount(0);
  await expect(page.getByText('Launched by Olga ·')).toBeVisible();
  await expect(page.getByTestId('broadcast-text')).toHaveText(text);
  await expect(breakdownLine(page, 'Sent to')).toContainText('3');
  await expect(broadcastRow(ana.page, 'Spring prices')).toContainText('Sending', WAIT);
  await expect(statusBadge(page, 'Sent')).toBeVisible(SENDING);
  await expect(page.getByText(/^Finished /)).toBeVisible(WAIT);
  await expect(total(page, 'Delivered')).toContainText('3', WAIT);
  await expect(total(page, 'Waiting')).toContainText('0');
  await expect(total(page, 'Blocked the bot')).toContainText('0');
  await expect(total(page, 'Failed')).toContainText('0');
  const report = page.getByTestId('broadcast-report').locator('tbody').getByRole('row');
  await expect(report).toHaveCount(3, WAIT);
  for (const name of ['Zoe', 'Yan', 'Max'])
    await expect(report.filter({ hasText: name })).toContainText('Delivered');
  await expect(report.filter({ hasText: 'Ivy' })).toHaveCount(0);
  await expect(broadcastRow(ana.page, 'Spring prices')).toContainText('Sent', WAIT);
  await expect(broadcastRow(ana.page, 'Spring prices')).toContainText('Launched by Olga');

  // Launched once: one message to each of the three, none to Ivy.
  const sent = await world.sentMessages(token);
  expect(sent.map((m) => Number(m.chat_id)).sort()).toEqual([792_001, 792_002, 792_003]);
  expect(sent.every((m) => m.text === text)).toBe(true);

  // Ana's inbox: Zoe is still closed and still 1 unread — the broadcast changed neither.
  await ana.page.goto(`/w/${workspaceId}/inbox?status=closed`);
  await expect(zoe.getByLabel('1 unread')).toBeVisible(WAIT);
  await ana.page.reload();
  await expect(zoe.getByLabel('1 unread')).toBeVisible(WAIT);
  await zoe.getByRole('link').first().click();
  const item = ana.page.getByTestId('broadcast-item');
  await expect(item).toBeVisible(WAIT);
  await expect(item.getByRole('link', { name: 'Spring prices' })).toHaveAttribute(
    'href',
    `/w/${workspaceId}/broadcasts/${draftId}`,
  );
  await expect(item).toContainText('sent by Olga');
  await expect(item.getByTestId('broadcast-item-text')).toHaveText(text);
  // Apart from the team's replies: no bubble carries it.
  await expect(ana.page.getByTestId('bubble').filter({ hasText: 'tulips' })).toHaveCount(0);

  await olga.context.close();
  await ana.context.close();
});

test('an owner stops a sending broadcast and duplicates it as "did not reach"; an operator sees no Stop (AC-18, AC-07)', async ({
  browser,
  world,
}) => {
  test.setTimeout(60_000);
  const { workspaceId, token } = await acme(world);
  await world.customersWrite(token, 12, 793_000, 'Customer');
  // No tag chosen: every contact. The first sends are held at the fake, the rest wait their turn.
  const draftId = await world.draftBroadcast(OWNER, workspaceId, 'Spring sale', 'Sale starts now');
  await world.scriptBot(token, {
    sendMessage: Array.from({ length: 8 }, () => sendAnswers.hang(8_000)),
  });

  const olga = await open(browser, OWNER, workspaceId, `/broadcasts/${draftId}`);
  const { page } = olga;
  await page.getByRole('button', { name: 'Launch' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Send this broadcast?' });
  await confirm.getByRole('button', { name: 'Send to 12 contacts' }).click();
  await expect(statusBadge(page, 'Sending')).toBeVisible(WAIT);

  // An operator on the same sending broadcast: Duplicate, but no Stop anywhere.
  const ana = await open(browser, OPERATOR, workspaceId, `/broadcasts/${draftId}`);
  await expect(statusBadge(ana.page, 'Sending')).toBeVisible(WAIT);
  await expect(ana.page.getByRole('button', { name: 'Duplicate' })).toBeVisible();
  await expect(ana.page.getByRole('button', { name: 'Stop' })).toHaveCount(0);

  // Olga stops it: the confirmation names the waiting recipients and that it can't be undone.
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const stop = page.getByRole('alertdialog', { name: 'Stop this broadcast?' });
  await expect(stop).toContainText(/(\d+ recipients are|1 recipient is) still waiting\./);
  await expect(stop).toContainText("A stop can't be undone.");
  await stop.getByRole('button', { name: 'Stop broadcast' }).click();
  await expect(stop).toHaveCount(0, WAIT);
  await expect(statusBadge(page, 'Stopped')).toBeVisible(WAIT);
  await expect(page.getByText('Stopped by Olga ·')).toBeVisible(WAIT);
  await expect(statusBadge(ana.page, 'Stopped')).toBeVisible(WAIT);
  await expect(ana.page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  const stoppedTotal = total(page, 'Not sent — stopped');
  await expect(stoppedTotal).toBeVisible(WAIT);
  const stopped = Number((await stoppedTotal.locator('span').last().textContent()) ?? '0');
  expect(stopped).toBeGreaterThan(0);

  // The sends already on their way finish as delivered; nothing more is ever sent.
  await expect(total(page, 'Waiting')).toContainText('0', SENDING);
  await expect(total(page, 'Delivered')).toContainText(String(12 - stopped), SENDING);
  expect(await world.sentMessages(token)).toHaveLength(12 - stopped);

  // Duplicate → only the recipients it did not reach → a new draft holding the stopped ones.
  await page.getByRole('button', { name: 'Duplicate' }).click();
  const copy = page.getByRole('dialog', { name: 'Duplicate “Spring sale”' });
  const notReached = copy.getByRole('radio', { name: "Only recipients it didn't reach" });
  await expect(notReached).toBeEnabled(WAIT);
  await expect(copy).toContainText(
    `${stopped} ${stopped === 1 ? 'contact' : 'contacts'} whose send failed for a reason a new attempt can fix`,
  );
  await notReached.click();
  await copy.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Copy of Spring sale' })).toBeVisible(
    WAIT,
  );
  await expect(page).not.toHaveURL(new RegExp(`/broadcasts/${draftId}$`));
  await expect(page.getByRole('radio', { name: 'Hand-picked group' })).toBeChecked();
  await expect(breakdownLine(page, 'Audience')).toContainText(
    `${stopped} ${stopped === 1 ? 'contact' : 'contacts'}`,
    WAIT,
  );
  await expect(
    page.getByRole('table', { name: 'Hand-picked group' }).locator('tbody').getByRole('row'),
  ).toHaveCount(stopped, WAIT);

  await olga.context.close();
  await ana.context.close();
});

test('Contacts marks a contact who blocked the bot live, the profile says since when, and an unblock clears it (AC-14)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 794_001, 'Hi there', 'Zoe')).toBe(200);
  expect(await world.customerWrites(token, 794_002, 'Hello', 'Yan')).toBe(200);
  const zoeId = await world.contactId(OWNER, workspaceId, 'Zoe');

  const olga = await open(browser, OWNER, workspaceId, '/contacts');
  const { page } = olga;
  const zoe = contactRows(page).filter({ hasText: 'Zoe' });
  await expect(zoe).toBeVisible(WAIT);
  await expect(zoe).not.toContainText('Blocked the bot');
  const before = await world.sentMessages(token);

  // Zoe blocks the bot in Telegram: her row is marked without a reload; Yan's is not.
  await world.customerBlocksBot(token, 794_001);
  await expect(zoe).toContainText('Blocked the bot', WAIT);
  await expect(contactRows(page).filter({ hasText: 'Yan' })).not.toContainText('Blocked the bot');

  // The block created no customer message: the inbox still holds each one message.
  await page.goto(`/w/${workspaceId}/contacts/${zoeId}`);
  const blocked = page.getByTestId('blocked-line');
  await expect(blocked).toContainText('Blocked the bot', WAIT);
  await expect(blocked).toContainText(/since \S/);
  await expect(page.getByTestId('bubble')).toHaveCount(1, WAIT);

  // She unblocks it: the line goes away live.
  await world.customerBlocksBot(token, 794_001, 'member');
  await expect(blocked).toHaveCount(0, WAIT);

  expect(await world.sentMessages(token)).toEqual(before);
  await olga.context.close();
});
