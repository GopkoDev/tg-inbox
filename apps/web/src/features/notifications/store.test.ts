import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type NotificationSettings } from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { useWorkspaceStore } from '@/features/workspaces/store';

const api = vi.hoisted(() => ({
  getNotificationSettings: vi.fn(),
  createConnectLink: vi.fn(),
  disconnectTelegram: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getNotificationSettings: (...a: unknown[]) => api.getNotificationSettings(...a),
  createConnectLink: (...a: unknown[]) => api.createConnectLink(...a),
  disconnectTelegram: (...a: unknown[]) => api.disconnectTelegram(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({ subscribeLive: () => () => undefined }));

import { connectRefusal } from './api';
import { useNotificationsStore } from './store';

const A = '0198f0c0-0000-7000-8000-000000000001';
const B = '0198f0c0-0000-7000-8000-000000000002';
const settings = (ws: string): NotificationSettings => ({
  workspace_id: ws,
  caller_role: 'operator',
  bot: { workspace_id: ws, state: 'connected', can_reply: true, receiving: true },
  telegram: { state: 'not_connected' },
  can_connect: true,
});
const guard = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  useNotificationsStore.getState().clear();
});

describe('notifications store', () => {
  it('drops a late answer of a workspace the store has left', async () => {
    let late!: (s: NotificationSettings) => void;
    api.getNotificationSettings.mockImplementationOnce(() => new Promise((r) => (late = r)));
    const first = useNotificationsStore.getState().load(A, guard);
    api.getNotificationSettings.mockResolvedValueOnce(settings(B));
    await useNotificationsStore.getState().load(B, guard);
    late(settings(A));
    await first;
    expect(useNotificationsStore.getState()).toMatchObject({
      workspaceId: B,
      settings: settings(B),
    });
  });

  it('a second action while one runs is ignored', async () => {
    api.getNotificationSettings.mockResolvedValue(settings(A));
    await useNotificationsStore.getState().load(A, guard);
    let done!: (v: unknown) => void;
    api.createConnectLink.mockReturnValue(new Promise((r) => (done = r)));
    const first = useNotificationsStore.getState().connect(A, guard);
    await expect(useNotificationsStore.getState().connect(A, guard)).resolves.toEqual({
      kind: 'busy',
    });
    done({});
    await first;
    expect(api.createConnectLink).toHaveBeenCalledTimes(1);
  });

  it('a workspace switch in the workspace store clears it', async () => {
    api.getNotificationSettings.mockResolvedValue(settings(A));
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    await useNotificationsStore.getState().load(A, guard);
    useWorkspaceStore.getState().setCurrent({ id: B, name: 'Bolt', role: 'operator' });
    expect(useNotificationsStore.getState()).toMatchObject({ workspaceId: null, settings: null });
  });

  it('a guard answer on connect is reported as guarded', async () => {
    api.getNotificationSettings.mockResolvedValue(settings(A));
    await useNotificationsStore.getState().load(A, guard);
    api.createConnectLink.mockRejectedValue(new ApiError(401, ErrorCode.UNAUTHENTICATED, 'x'));
    await expect(useNotificationsStore.getState().connect(A, guard)).resolves.toEqual({
      kind: 'guarded',
    });
    expect(guard).toHaveBeenCalled();
  });
});

describe('connectRefusal', () => {
  it('reads the limit, both 409s and nothing else', () => {
    const retry = '2026-10-19T09:26:00.000Z';
    expect(
      connectRefusal(
        new ApiError(429, ErrorCode.CONNECT_LINK_LIMIT_REACHED, 'x', {
          limit: 5,
          window_seconds: 600,
          retry_at: retry,
        }),
      ),
    ).toEqual({ kind: 'limit', retryAt: retry });
    expect(
      connectRefusal(
        new ApiError(409, ErrorCode.TELEGRAM_ALREADY_LINKED, 'x', { settings: settings(A) }),
      ),
    ).toEqual({ kind: 'already_linked', settings: settings(A) });
    expect(
      connectRefusal(
        new ApiError(409, ErrorCode.PINGS_NEED_WORKING_BOT, 'x', { settings: settings(A) }),
      ),
    ).toEqual({ kind: 'no_working_bot', settings: settings(A) });
    expect(
      connectRefusal(new ApiError(429, ErrorCode.CONNECT_LINK_LIMIT_REACHED, 'x', {})),
    ).toBeNull();
    expect(connectRefusal(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'))).toBeNull();
    expect(connectRefusal(new Error('x'))).toBeNull();
  });
});
