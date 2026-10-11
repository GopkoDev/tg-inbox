import { ErrorCode, type BotSettings } from '@tg/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';

const getBotSettings = vi.fn();
vi.mock('./api', () => ({
  getBotSettings: (w: string, o?: unknown) => getBotSettings(w, o),
}));

import { useBotStore } from './store';

const connected: BotSettings = {
  state: 'connected',
  bot: { name: 'Acme Flowers Bot', username: 'acme_flowers_bot' },
  last_checked_at: '2026-10-11T10:00:00.000Z',
  last_message_received_at: null,
  contacts_count: 12,
};
const notConnected: BotSettings = { state: 'not_connected' };
const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const bolt = { id: 'w2', name: 'Bolt Bikes', role: 'owner' as const };

beforeEach(() => {
  vi.resetAllMocks();
  useWorkspaceStore.getState().clear();
  useBotStore.getState().clear();
});

describe('bot store', () => {
  it('starts empty and loading, with no token field anywhere', () => {
    const s = useBotStore.getState();
    expect(s).toMatchObject({ workspaceId: null, settings: null, status: 'loading', notice: null });
    expect(Object.keys(s)).not.toContain('token');
  });

  it('load: fetches the workspace settings and becomes ready', async () => {
    getBotSettings.mockResolvedValue(connected);
    await useBotStore.getState().load('w1');
    expect(getBotSettings).toHaveBeenCalledWith('w1', undefined);
    expect(useBotStore.getState()).toMatchObject({
      workspaceId: 'w1',
      settings: connected,
      status: 'ready',
    });
  });

  it('load: OWNER_ONLY → owners_only, no settings', async () => {
    getBotSettings.mockRejectedValue(new ApiError(403, ErrorCode.OWNER_ONLY, 'Only owners'));
    await useBotStore.getState().load('w1');
    expect(useBotStore.getState()).toMatchObject({ settings: null, status: 'owners_only' });
  });

  it('load: other errors go to the guard; not-found → not_found, handled → no error row', async () => {
    const notFound = new ApiError(404, ErrorCode.NOT_FOUND, 'Not found');
    getBotSettings.mockRejectedValue(notFound);
    const guard = vi.fn().mockResolvedValue('not-found');
    await useBotStore.getState().load('w1', guard);
    expect(guard).toHaveBeenCalledWith(notFound, 'w1');
    expect(useBotStore.getState().status).toBe('not_found');

    guard.mockResolvedValue('handled');
    await useBotStore.getState().load('w1', guard);
    expect(useBotStore.getState().status).toBe('loading');
  });

  it('load: an error the guard rethrows (or no guard) → error', async () => {
    getBotSettings.mockRejectedValue(new Error('network'));
    await useBotStore.getState().load('w1');
    expect(useBotStore.getState().status).toBe('error');
    const guard = vi.fn().mockRejectedValue(new Error('network'));
    await useBotStore.getState().load('w1', guard);
    expect(useBotStore.getState().status).toBe('error');
  });

  it('a load answered after a switch to another workspace is dropped', async () => {
    let resolve!: (s: BotSettings) => void;
    getBotSettings.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const first = useBotStore.getState().load('w1');
    getBotSettings.mockResolvedValueOnce(notConnected);
    await useBotStore.getState().load('w2');
    resolve(connected);
    await first;
    expect(useBotStore.getState()).toMatchObject({ workspaceId: 'w2', settings: notConnected });
  });

  it('replace: every action response replaces the settings (and may set a notice)', async () => {
    getBotSettings.mockResolvedValue(notConnected);
    await useBotStore.getState().load('w1');
    useBotStore.getState().replace('w1', connected, { tone: 'success', text: 'Bot connected' });
    expect(useBotStore.getState()).toMatchObject({
      settings: connected,
      status: 'ready',
      notice: { tone: 'success', text: 'Bot connected' },
    });
    useBotStore.getState().replace('w1', notConnected);
    expect(useBotStore.getState()).toMatchObject({ settings: notConnected, notice: null });
  });

  it('an action response for a workspace the store has since left is dropped', async () => {
    getBotSettings.mockResolvedValue(notConnected);
    await useBotStore.getState().load('w2');
    useBotStore.getState().replace('w1', connected, { tone: 'success', text: 'Bot connected' });
    useBotStore.getState().setNotice('w1', { tone: 'error', text: 'Telegram is not responding' });
    expect(useBotStore.getState()).toMatchObject({
      workspaceId: 'w2',
      settings: notConnected,
      status: 'ready',
      notice: null,
    });
    useBotStore.getState().markRefused('w1', 'owners_only');
    expect(useBotStore.getState()).toMatchObject({ settings: notConnected, status: 'ready' });

    useBotStore.getState().clear();
    useBotStore.getState().replace('w1', connected);
    expect(useBotStore.getState()).toMatchObject({ workspaceId: null, settings: null });
  });

  it('a foreground reload of the same workspace drops the old notice', async () => {
    getBotSettings.mockResolvedValue(connected);
    await useBotStore.getState().load('w1');
    useBotStore.getState().setNotice('w1', { tone: 'error', text: 'Telegram is not responding' });
    await useBotStore.getState().load('w1', undefined, { background: true });
    expect(useBotStore.getState().notice).not.toBeNull();
    await useBotStore.getState().load('w1');
    expect(useBotStore.getState().notice).toBeNull();
  });

  it('clear: empties the store', async () => {
    getBotSettings.mockResolvedValue(connected);
    await useBotStore.getState().load('w1');
    useBotStore.getState().clear();
    expect(useBotStore.getState()).toMatchObject({
      workspaceId: null,
      settings: null,
      status: 'loading',
      notice: null,
    });
  });

  it('is cleared when the workspace is switched', async () => {
    useWorkspaceStore.getState().setCurrent(acme);
    getBotSettings.mockResolvedValue(connected);
    await useBotStore.getState().load('w1');
    useWorkspaceStore.getState().setCurrent(acme);
    expect(useBotStore.getState().settings).toEqual(connected);
    useWorkspaceStore.getState().setCurrent(bolt);
    expect(useBotStore.getState().settings).toBeNull();
  });

  it('is cleared when access to the workspace is removed (or on sign-out)', async () => {
    useWorkspaceStore.getState().setCurrent(acme);
    getBotSettings.mockResolvedValue(connected);
    await useBotStore.getState().load('w1');
    useWorkspaceStore.getState().clearWorkspace('w1');
    expect(useBotStore.getState().settings).toBeNull();

    useWorkspaceStore.getState().setCurrent(acme);
    await useBotStore.getState().load('w1');
    useWorkspaceStore.getState().clear();
    expect(useBotStore.getState().settings).toBeNull();
  });
});
