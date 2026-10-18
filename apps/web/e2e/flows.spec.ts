import type { Page } from '@playwright/test';
import { expect, PASSWORD, test } from './support/world.ts';

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'));
}

const workspaceButton = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name });

/** Opens SCR-07 by its address, as a bookmark or reload would — the app shell must enter the workspace itself. */
async function openTeam(page: Page, workspaceId: string, workspaceName: string) {
  await page.goto(`/w/${workspaceId}/settings/team`);
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/settings/team$`));
  await expect(workspaceButton(page, workspaceName)).toBeVisible();
}

async function signOut(page: Page, email: string) {
  await page.getByRole('button', { name: email }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('join as a new person lands on the workspace home (AC-03)', async ({ page, world }) => {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', 'boss@example.test');
  const link = await world.invite('boss@example.test', workspaceId, 'ana@example.test');

  await page.goto(link);
  await expect(page.getByLabel('Email')).toHaveValue('ana@example.test');
  await page.getByLabel('Your name').fill('Ana');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account and join' }).click();

  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/inbox$`));
  await expect(workspaceButton(page, 'Acme Flowers')).toBeVisible();
  await expect(page.getByText('Your inbox arrives here')).toBeVisible();
});

test('join with an existing account keeps the other workspace in the switcher (AC-04)', async ({
  page,
  world,
}) => {
  const first = await world.workspaceWithOwner('Acme Flowers', 'boss@example.test');
  const bolt = await world.workspaceWithOwner('Bolt Bikes', 'chief@example.test');
  await world.joinOperator('boss@example.test', first, 'both@example.test', 'Both');
  const second = await world.invite('chief@example.test', bolt, 'both@example.test');

  await page.goto(second);
  await expect(
    page.getByText('both@example.test already has a tg-inbox account. Enter its password to join.'),
  ).toBeVisible();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Join workspace' }).click();

  await expect(workspaceButton(page, 'Bolt Bikes')).toBeVisible();
  await workspaceButton(page, 'Bolt Bikes').click();
  await expect(page.getByRole('menuitem', { name: /Acme Flowers/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Bolt Bikes/ })).toBeVisible();
});

test('sign in, sign out, and the panel asks to sign in again (AC-07, AC-11)', async ({
  page,
  world,
}) => {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', 'boss@example.test', 'Olga');

  await page.goto('/sign-in');
  await signIn(page, 'boss@example.test');
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/inbox$`));
  await expect(workspaceButton(page, 'Acme Flowers')).toBeVisible();

  await signOut(page, 'boss@example.test');
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.goto(`/w/${workspaceId}`);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText('Sign in to continue')).toBeVisible();
  await signIn(page, 'boss@example.test'); // returns to the remembered address
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/inbox$`));
});

test('switch workspace shows only the picked workspace name (AC-12)', async ({ page, world }) => {
  const acme = await world.workspaceWithOwner('Acme Flowers', 'boss@example.test');
  const bolt = await world.workspaceWithOwner('Bolt Bikes', 'chief@example.test');
  await world.joinOperator('chief@example.test', bolt, 'boss@example.test');

  await page.goto('/sign-in');
  await signIn(page, 'boss@example.test');
  await page.goto(`/w/${acme}`);
  await expect(workspaceButton(page, 'Acme Flowers')).toBeVisible();

  await workspaceButton(page, 'Acme Flowers').click();
  await page.getByRole('menuitem', { name: /Bolt Bikes/ }).click();

  await expect(page).toHaveURL(new RegExp(`/w/${bolt}/inbox$`));
  await expect(workspaceButton(page, 'Bolt Bikes')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Workspace' }).getByText('Acme Flowers'),
  ).toHaveCount(0);
});

test('sign in opens the last-used workspace, not the picker (AC-07, AC-12)', async ({
  page,
  world,
}) => {
  await world.workspaceWithOwner('Acme Flowers', 'boss@example.test');
  const bolt = await world.workspaceWithOwner('Bolt Bikes', 'chief@example.test');
  await world.joinOperator('chief@example.test', bolt, 'boss@example.test');

  await page.goto('/sign-in');
  await signIn(page, 'boss@example.test');
  await page.goto(`/w/${bolt}`);
  await expect(workspaceButton(page, 'Bolt Bikes')).toBeVisible();

  await signOut(page, 'boss@example.test');
  await expect(page).toHaveURL(/\/sign-in$/);
  await signIn(page, 'boss@example.test');

  await expect(page).toHaveURL(new RegExp(`/w/${bolt}/inbox$`));
  await expect(workspaceButton(page, 'Bolt Bikes')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Workspace' }).getByText('Acme Flowers'),
  ).toHaveCount(0);
});

test('invite a teammate: link shown once, then a pending row without it (AC-14)', async ({
  page,
  world,
}) => {
  const workspaceId = await world.workspaceWithOwner('Acme Flowers', 'boss@example.test');

  await page.goto('/sign-in');
  await signIn(page, 'boss@example.test');
  await openTeam(page, workspaceId, 'Acme Flowers');
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Email').fill('hire@example.test');
  await page.getByRole('button', { name: 'Create invitation' }).click();

  const dialog = page.getByRole('dialog');
  const linkField = dialog.getByLabel('Invitation link');
  await expect(linkField).toHaveValue(/\/invite\/[\w-]+$/);
  const link = await linkField.inputValue();
  await dialog.getByRole('button', { name: 'Copy' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  const pending = page.getByTestId('pending-invitations');
  await expect(pending.getByText('hire@example.test')).toBeVisible();
  await expect(pending.getByText('/invite/')).toHaveCount(0);
  await expect(page.getByText(link)).toHaveCount(0);
  await page.reload();
  await expect(workspaceButton(page, 'Acme Flowers')).toBeVisible();
  await expect(
    page.getByTestId('pending-invitations').getByText('hire@example.test'),
  ).toBeVisible();
  await expect(page.getByLabel('Invitation link')).toHaveCount(0);
});

test('deactivating a member with a second tab open shows the access-removed notice (AC-17)', async ({
  browser,
  world,
}) => {
  const acme = await world.workspaceWithOwner('Acme Flowers', 'boss@example.test', 'Olga');
  const bolt = await world.workspaceWithOwner('Bolt Bikes', 'chief@example.test');
  await world.joinOperator('boss@example.test', acme, 'sam@example.test', 'Sam', 'owner');
  await world.joinOperator('chief@example.test', bolt, 'sam@example.test');

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto('/sign-in');
  await signIn(member, 'sam@example.test');
  await openTeam(member, acme, 'Acme Flowers');
  await expect(member.getByRole('button', { name: 'Invite', exact: true })).toBeVisible();

  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto('/sign-in');
  await signIn(owner, 'boss@example.test');
  await openTeam(owner, acme, 'Acme Flowers');
  await owner
    .getByRole('row', { name: /Sam/ })
    .getByRole('button', { name: /^Actions for / })
    .click();
  await owner.getByRole('menuitem', { name: 'Deactivate' }).click();
  await owner.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(owner.getByRole('row', { name: /Sam/ }).getByText('Deactivated')).toBeVisible();

  // The member's next action in the still-open tab hits the shared guard.
  await member.getByRole('button', { name: 'Invite', exact: true }).click();
  await member.getByRole('dialog').getByLabel('Email').fill('hire@example.test');
  await member.getByRole('button', { name: 'Create invitation' }).click();
  await expect(member).toHaveURL(new RegExp(`/w/${bolt}/inbox$`));
  await expect(workspaceButton(member, 'Bolt Bikes')).toBeVisible();
  await expect(member.getByText('Your access to Acme Flowers was removed')).toBeVisible();

  await memberContext.close();
  await ownerContext.close();
});
