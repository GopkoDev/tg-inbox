import { describe, expect, it } from 'vitest';
import { answerText, type AnswerContext } from './answers.js';

const ctx: AnswerContext = {
  workspaceName: 'Acme Flowers',
  workspaceId: 'ws-1',
  panelUrl: 'https://app.example.test',
};
const settingsUrl = 'https://app.example.test/w/ws-1/settings/notifications';

describe('answerText (TG-02)', () => {
  it('connected', () => {
    expect(answerText('connected', ctx)).toBe(
      `You're connected to Acme Flowers. I'll message you here when customers are waiting for a reply.\nTo stop, disconnect Telegram in the panel:\n${settingsUrl}`,
    );
  });

  it('already_connected', () => {
    expect(answerText('already_connected', ctx)).toBe(
      "You're already connected to Acme Flowers with this Telegram account.",
    );
  });

  it('cannot_connect, the Telegram account belongs to a teammate (AC-06)', () => {
    expect(answerText('cannot_connect', { ...ctx, reason: 'telegram_linked_to_teammate' })).toBe(
      "This Telegram account can't be connected: it already receives notifications for another member of Acme Flowers.",
    );
  });

  it('cannot_connect, the member is linked from another account (AC-06)', () => {
    expect(answerText('cannot_connect', { ...ctx, reason: 'member_linked_elsewhere' })).toBe(
      `This Telegram account can't be connected: you're already connected from another Telegram account — disconnect it in the panel first.\n${settingsUrl}`,
    );
  });

  it('cannot_connect needs a reason', () => {
    expect(() => answerText('cannot_connect', ctx)).toThrow();
  });

  it('link_expired names no workspace and carries no link (AC-05)', () => {
    const text = answerText('link_expired', ctx);
    expect(text).toBe(
      'This connect link has expired. Get a new one in the panel, in Settings → Notifications.',
    );
    expect(text).not.toContain('Acme');
    expect(text).not.toContain('http');
  });

  it('notifications_off', () => {
    expect(answerText('notifications_off', ctx)).toBe(
      'Notifications from Acme Flowers are off. You can connect again in the panel at any time.',
    );
  });

  it('chat_only_notifications links to the inbox (AC-11)', () => {
    expect(answerText('chat_only_notifications', ctx)).toBe(
      'This chat only sends notifications from Acme Flowers. Replies to customers are written in the panel:\nhttps://app.example.test/w/ws-1/inbox',
    );
  });

  it('puts every link on its own line and drops a trailing slash of the panel url', () => {
    const text = answerText('connected', { ...ctx, panelUrl: 'https://app.example.test/' });
    expect(text.split('\n').at(-1)).toBe(settingsUrl);
  });

  it('is plain text: the workspace name is not escaped or wrapped', () => {
    expect(answerText('notifications_off', { ...ctx, workspaceName: '<b>*A*_' })).toContain(
      'from <b>*A*_ are off',
    );
  });
});
