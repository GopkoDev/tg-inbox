import { fixedClock } from '../../../platform/clock.js';
import {
  fakeBotRepo,
  fakeBotTransaction,
  fakeContactsApi,
  fakeConversationsApi,
  fakeGateway,
  type FakeBotRow,
} from './fakes.js';
import { createBotSettings } from './settings.js';
import { createPasteToken } from './paste-token.js';
import type { WebhookSecrets } from './ports.js';

/** Test wiring of the bots owner use cases over in-memory fakes. */
export const T0 = new Date('2026-10-11T10:00:00Z');
export const at = (s: number) => new Date(T0.getTime() + s * 1000);
export const BASE_URL = 'https://inbox.example.test';
export const tokenOf = (telegramBotId: bigint, tag = 'a') =>
  `${telegramBotId}:TEST-${tag.repeat(35)}`;

export function botRow(o: Partial<FakeBotRow> = {}): FakeBotRow {
  return {
    id: '0199a000-0000-7000-8000-000000000001',
    workspaceId: 'ws-a',
    telegramBotId: 100001n,
    name: 'Old Name',
    username: 'old_name_bot',
    state: 'connected',
    connectedAt: at(0),
    lastCheckedAt: at(0),
    createdAt: at(0),
    token: tokenOf(100001n, 'o'),
    webhookSecret: 'stored-secret',
    ...o,
  };
}

export function createBotsHarness(rows: FakeBotRow[] = []) {
  const bots = fakeBotRepo();
  bots.rows.push(...rows);
  const telegram = fakeGateway();
  const clock = fixedClock(at(600));
  const conversations = fakeConversationsApi();
  const contacts = fakeContactsApi();
  // Derived like the real one: stable per (bot, capture epoch), new on a new epoch.
  const secrets: WebhookSecrets = {
    secretFor: (botId, connectedAt) => `secret-${botId}-${connectedAt.getTime()}`,
  };
  const transaction = fakeBotTransaction(bots);
  const settings = createBotSettings({ bots, conversations, contacts });
  const paste = createPasteToken({
    bots,
    telegram,
    secrets,
    clock,
    transaction,
    settings,
    webhookBaseUrl: BASE_URL,
  });
  return { bots, telegram, clock, conversations, contacts, secrets, transaction, settings, paste };
}
