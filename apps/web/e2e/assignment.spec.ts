import type { Browser, Page } from '@playwright/test';
import { expect, PASSWORD, test, type World } from './support/world.ts';

/**
 * The assignment-statuses flows (AC-01, AC-02, AC-03, AC-06, AC-07) in real browsers against the
 * API, an ephemeral database and the fake Bot API. Seeding goes through the HTTP API and the
 * webhook, never the UI under test; every wait is on visible text (5 s ceiling, the 3 s live target).
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
 * A signed-in browser context on `path` of the workspace. With `live: false` its live socket
 * stays silent (it opens, nothing arrives), so the view goes stale as a slow connection would.
 */
async function open(
  browser: Browser,
  email: string,
  workspaceId: string,
  path = '/inbox',
  live = true,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (!live) await page.routeWebSocket(/\/inbox\/live/, () => {});
  await signIn(page, email);
  await page.goto(`/w/${workspaceId}${path}`);
  return { context, page };
}

const rows = (page: Page) =>
  page.getByRole('list', { name: 'Conversations' }).getByRole('listitem');
const row = (page: Page, customer: string) => rows(page).filter({ hasText: customer });
const bubble = (page: Page, text: string) => page.getByTestId('bubble').getByText(text);
const actions = (page: Page) => page.getByTestId('conversation-actions');
const lines = (page: Page) => page.getByTestId('activity-line');
const lensTab = (page: Page, name: 'Open' | 'Closed') =>
  page.getByTestId('lens-controls').getByRole('tab', { name });
const assigneeSelect = (page: Page) => page.getByTestId('lens-controls').getByLabel('Assignee');
const workspaceButton = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name });

/** Acme Flowers: an owner (Olga), an operator (Ana) and a connected bot. */
async function acme(world: World) {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', OWNER, 'Olga');
  await world.joinOperator(OWNER, workspaceId, OPERATOR, 'Ana');
  const token = world.botToken(640_001n);
  await world.scriptBot(token, {});
  await world.connectBot(OWNER, workspaceId, token);
  return { workspaceId, token };
}

test('lenses: open · all by default, mine, unassigned, closed, search, and the address keeps them (AC-01)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  const name = (n: number) => `Cust${String(n).padStart(2, '0')}`;
  for (let n = 1; n <= 30; n++) {
    expect(await world.customerWrites(token, 740_000 + n, `Question ${n}`, name(n))).toBe(200);
  }
  for (let n = 1; n <= 5; n++) await world.assign(OPERATOR, workspaceId, name(n), 'Ana');
  for (let n = 6; n <= 10; n++) await world.assign(OWNER, workspaceId, name(n), 'Olga');
  await world.assign(OPERATOR, workspaceId, name(11), 'Ana');
  await world.assign(OWNER, workspaceId, name(13), 'Olga');
  for (const n of [11, 12, 13]) await world.close(OWNER, workspaceId, name(n));

  // A second workspace for Ana, to prove the switch starts again at open · all.
  const bolt = await world.workspaceWithOwner('Bolt Bikes', 'chief@example.test');
  await world.joinOperator('chief@example.test', bolt, OPERATOR);

  const ana = await open(browser, OPERATOR, workspaceId);
  const { page } = ana;
  // Default: open conversations of every assignee, newest activity first, assignee on each row.
  await expect(rows(page)).toHaveCount(27, WAIT);
  await expect(rows(page).first()).toContainText('Cust30');
  await expect(rows(page).first()).toContainText('Unassigned');
  await expect(row(page, 'Cust01')).toContainText('Ana');
  await expect(row(page, 'Cust01')).toContainText('Question 1'); // the assignment is not the preview
  await expect(row(page, 'Cust06')).toContainText('Olga');
  await expect(row(page, 'Cust11')).toHaveCount(0);
  await expect(lensTab(page, 'Open')).toHaveAttribute('data-state', 'active');
  await expect(assigneeSelect(page)).toContainText('All');

  await assigneeSelect(page).click();
  await page.getByRole('option', { name: 'Mine' }).click();
  await expect(page).toHaveURL(/assignee=mine/);
  await expect(rows(page)).toHaveCount(5, WAIT);
  await expect(rows(page).filter({ hasText: 'Olga' })).toHaveCount(0);

  await assigneeSelect(page).click();
  await page.getByRole('option', { name: 'Unassigned' }).click();
  await expect(rows(page)).toHaveCount(17, WAIT);
  await expect(rows(page).filter({ hasText: 'Unassigned' })).toHaveCount(17);

  // Closed in the chosen assignee lens, then the same lenses from the address after a reload.
  await lensTab(page, 'Closed').click();
  await expect(page).toHaveURL(/status=closed/);
  await expect(rows(page)).toHaveCount(1, WAIT);
  await expect(rows(page).first()).toContainText('Cust12');
  await page.goto(`/w/${workspaceId}/inbox?status=closed&assignee=mine`);
  await expect(rows(page)).toHaveCount(1, WAIT);
  await expect(rows(page).first()).toContainText('Cust11');
  await expect(lensTab(page, 'Closed')).toHaveAttribute('data-state', 'active');
  await expect(assigneeSelect(page)).toContainText('Mine');
  await page.reload();
  await expect(rows(page)).toHaveCount(1, WAIT);
  await expect(rows(page).first()).toContainText('Cust11');

  // The back button restores the previous lenses.
  await lensTab(page, 'Open').click();
  await expect(rows(page)).toHaveCount(5, WAIT);
  await page.goBack();
  await expect(page).toHaveURL(/status=closed/);
  await expect(rows(page)).toHaveCount(1, WAIT);
  await expect(rows(page).first()).toContainText('Cust11');

  // Searching sets the status lens aside; a closed match is marked, inside the assignee lens.
  await page.getByLabel('Search conversations').fill('Cust1');
  await expect(
    row(page, 'Cust11').locator('[data-slot="badge"]', { hasText: 'Closed' }),
  ).toBeVisible(WAIT);
  await expect(row(page, 'Cust12')).toHaveCount(0); // not Ana's
  await expect(row(page, 'Cust01')).toHaveCount(0);

  // A lens that holds nothing says so.
  await page.goto(`/w/${bolt}/inbox?status=closed&assignee=unassigned`);
  await expect(page.getByText('No closed conversations without an assignee.')).toBeVisible(WAIT);

  // Switching workspace starts again at open · all.
  await page.goto(`/w/${workspaceId}/inbox?status=closed&assignee=mine`);
  await expect(rows(page)).toHaveCount(1, WAIT);
  await workspaceButton(page, 'Acme Flowers').click();
  await page.getByRole('menuitem', { name: /Bolt Bikes/ }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${bolt}/inbox$`));
  await expect(lensTab(page, 'Open')).toHaveAttribute('data-state', 'active');
  await expect(assigneeSelect(page)).toContainText('All');

  // A business owner sees and does the same.
  const owner = await open(browser, OWNER, workspaceId, '/inbox?assignee=mine');
  await expect(rows(owner.page)).toHaveCount(5, WAIT);
  await expect(rows(owner.page).filter({ hasText: 'Olga' })).toHaveCount(5);

  await ana.context.close();
  await owner.context.close();
});

test('assigning from the thread reaches a teammate live; the row leaves their lens but the thread stays (AC-02)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 741_001, 'Do you deliver?', 'Zoe')).toBe(200);
  expect(await world.customerWrites(token, 741_002, 'Price of tulips?', 'Yan')).toBe(200);

  const ana = await open(browser, OPERATOR, workspaceId);
  // Olga reads Zoe's thread while looking at the unassigned lens.
  const olga = await open(browser, OWNER, workspaceId, '/inbox?assignee=unassigned');
  await expect(rows(olga.page)).toHaveCount(2, WAIT);
  await row(olga.page, 'Zoe').click();
  await expect(bubble(olga.page, 'Do you deliver?')).toBeVisible(WAIT);
  await expect(actions(olga.page)).toContainText('Unassigned');

  await row(ana.page, 'Zoe').click();
  await expect(bubble(ana.page, 'Do you deliver?')).toBeVisible(WAIT);
  await actions(ana.page)
    .getByRole('button', { name: /Unassigned/ })
    .click();
  await ana.page.getByRole('button', { name: 'Me (Ana)' }).click();

  // Ana's header and line, then Olga's list row and header, without reloading.
  await expect(actions(ana.page)).toContainText('Ana', WAIT);
  await expect(lines(ana.page).filter({ hasText: 'Ana assigned this to Ana' })).toBeVisible(WAIT);
  await expect(row(ana.page, 'Zoe')).toContainText('Ana', WAIT);
  await expect(rows(olga.page)).toHaveCount(1, WAIT); // the row left the unassigned lens
  await expect(row(olga.page, 'Yan')).toBeVisible();
  await expect(actions(olga.page)).toContainText('Ana', WAIT); // the thread stays open
  await expect(bubble(olga.page, 'Do you deliver?')).toBeVisible();
  await expect(lines(olga.page).filter({ hasText: 'Ana assigned this to Ana' })).toBeVisible(WAIT);

  // The conversation keeps its place: Zoe was first (older) than Yan in the all lens.
  await olga.page.goto(`/w/${workspaceId}/inbox`);
  await expect(rows(olga.page).first()).toContainText('Yan', WAIT);
  await expect(rows(olga.page).nth(1)).toContainText('Zoe');
  await expect(rows(olga.page).nth(1)).toContainText('Do you deliver?');

  // Unassigning brings the row back to the unassigned lens for Olga.
  await olga.page.goto(`/w/${workspaceId}/inbox?assignee=unassigned`);
  await expect(rows(olga.page)).toHaveCount(1, WAIT);
  await actions(ana.page).getByRole('button', { name: /Ana/ }).click();
  await ana.page.getByRole('button', { name: 'Unassign', exact: true }).click();
  await expect(lines(ana.page).filter({ hasText: 'Ana unassigned this' })).toBeVisible(WAIT);
  await expect(rows(olga.page)).toHaveCount(2, WAIT);
  await expect(row(olga.page, 'Zoe')).toContainText('Unassigned');

  await ana.context.close();
  await olga.context.close();
});

test('a stale assign asks first: leave it changes nothing, go ahead takes it over (AC-03)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 742_001, 'Can I change my order?', 'Zoe')).toBe(200);

  // Ana's view goes quiet: she keeps the assignee and status she last saw (unassigned · open).
  const ana = await open(browser, OPERATOR, workspaceId, '/inbox', false);
  await row(ana.page, 'Zoe').click();
  await expect(bubble(ana.page, 'Can I change my order?')).toBeVisible(WAIT);
  await expect(actions(ana.page)).toContainText('Unassigned');

  await world.assign(OWNER, workspaceId, 'Zoe', 'Olga'); // Olga took it meanwhile

  await actions(ana.page)
    .getByRole('button', { name: /Unassigned/ })
    .click();
  await ana.page.getByRole('button', { name: 'Me (Ana)' }).click();
  const dialog = ana.page.getByRole('alertdialog', {
    name: 'This conversation changed since you looked',
  });
  await expect(dialog).toBeVisible(WAIT);
  await expect(dialog.getByTestId('state-now')).toHaveText('Now: assigned to Olga · Open');
  await expect(dialog.getByTestId('latest-change')).toContainText('Olga assigned this to Olga');

  await dialog.getByRole('button', { name: 'Leave it' }).click();
  await expect(ana.page.getByRole('alertdialog')).toHaveCount(0);
  await expect(actions(ana.page)).not.toContainText('Ana');

  // Leaving it shows the current state; Olga then lets go, and Ana's next try is stale again.
  await expect(actions(ana.page)).toContainText('Olga');
  await world.unassign(OWNER, workspaceId, 'Zoe');
  await actions(ana.page).getByRole('button', { name: /Olga/ }).click();
  await ana.page.getByRole('button', { name: 'Me (Ana)' }).click();
  await expect(dialog).toBeVisible(WAIT);
  await expect(dialog.getByTestId('state-now')).toHaveText('Now: unassigned · Open');
  await dialog.getByRole('button', { name: 'Assign to Ana' }).click();
  await expect(ana.page.getByRole('alertdialog')).toHaveCount(0, WAIT);
  await expect(actions(ana.page)).toContainText('Ana', WAIT);

  // The change is recorded for everyone: Olga's open thread shows the reassignment.
  const olga = await open(browser, OWNER, workspaceId);
  await row(olga.page, 'Zoe').click();
  await expect(row(olga.page, 'Zoe')).toContainText('Ana', WAIT);
  await expect(lines(olga.page).filter({ hasText: 'Ana assigned this to Ana' })).toBeVisible(WAIT);

  await ana.context.close();
  await olga.context.close();
});

test('closing over a waiting customer asks, asks again after a new message, then closes (AC-06)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 743_001, 'Is it still fresh?', 'Zoe')).toBe(200);
  expect(await world.customerWrites(token, 743_002, 'Hello', 'Yan')).toBe(200);

  const ana = await open(browser, OPERATOR, workspaceId);
  const { page } = ana;
  await row(page, 'Zoe').click();
  await expect(bubble(page, 'Is it still fresh?')).toBeVisible(WAIT);

  await actions(page).getByRole('button', { name: 'Close', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Close this conversation?' });
  await expect(dialog).toContainText('The customer is waiting for a reply', WAIT);

  // Keep it open: nothing changes.
  await dialog.getByRole('button', { name: 'Keep it open' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(actions(page).locator('[data-slot="badge"]')).toHaveText('Open');

  // A message arrives while the question is open: closing anyway asks again.
  await actions(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeVisible(WAIT);
  expect(await world.customerWrites(token, 743_001, 'Hello? Anyone?', 'Zoe')).toBe(200);
  await expect(bubble(page, 'Hello? Anyone?')).toBeVisible(WAIT);
  await dialog.getByRole('button', { name: 'Close anyway' }).click();
  await expect(
    dialog.getByText('Something changed while you were deciding — check again.'),
  ).toBeVisible(WAIT);
  await dialog.getByRole('button', { name: 'Close anyway' }).click();

  await expect(page.getByRole('alertdialog')).toHaveCount(0, WAIT);
  await expect(actions(page).locator('[data-slot="badge"]')).toHaveText('Closed', WAIT);
  await expect(lines(page).filter({ hasText: 'Ana closed this' })).toBeVisible(WAIT);
  await expect(row(page, 'Zoe')).toHaveCount(0, WAIT); // gone from the open lens
  await lensTab(page, 'Closed').click();
  await expect(rows(page)).toHaveCount(1, WAIT);
  await expect(rows(page).first()).toContainText('Zoe');
  await expect(rows(page).first()).toContainText('Hello? Anyone?');

  await ana.context.close();
});

test('a customer writing to a closed conversation reopens it with the same assignee, live (AC-07)', async ({
  browser,
  world,
}) => {
  const { workspaceId, token } = await acme(world);
  expect(await world.customerWrites(token, 744_001, 'Are you open?', 'Zoe')).toBe(200);
  await world.assign(OPERATOR, workspaceId, 'Zoe', 'Ana');
  await world.close(OPERATOR, workspaceId, 'Zoe');

  const ana = await open(browser, OPERATOR, workspaceId, '/inbox?status=closed&assignee=mine');
  const olga = await open(browser, OWNER, workspaceId);
  await expect(rows(ana.page)).toHaveCount(1, WAIT);
  await expect(rows(olga.page)).toHaveCount(0, WAIT);
  await row(ana.page, 'Zoe').click();
  await expect(actions(ana.page).locator('[data-slot="badge"]')).toHaveText('Closed', WAIT);

  expect(await world.customerWrites(token, 744_001, 'Still there?', 'Zoe')).toBe(200);

  // The thread reopens in place; the row leaves the closed lens and joins the open one.
  await expect(actions(ana.page).locator('[data-slot="badge"]')).toHaveText('Open', WAIT);
  await expect(actions(ana.page)).toContainText('Ana');
  await expect(bubble(ana.page, 'Still there?')).toBeVisible(WAIT);
  await expect(lines(ana.page).filter({ hasText: 'reopened — the customer wrote' })).toBeVisible(
    WAIT,
  );
  await expect(row(ana.page, 'Zoe')).toHaveCount(0, WAIT);
  await expect(rows(olga.page)).toHaveCount(1, WAIT);
  await expect(rows(olga.page).first()).toContainText('Zoe');
  await expect(rows(olga.page).first()).toContainText('Ana');
  await expect(rows(olga.page).first()).toContainText('Waiting for a reply');

  await ana.context.close();
  await olga.context.close();
});
