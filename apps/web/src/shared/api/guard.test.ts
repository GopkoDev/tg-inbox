import { ErrorCode } from '@tg/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from './client';
import { handleGuardError, type GuardContext } from './guard';

const account = { id: 'a1', email: 'o@x.io', display_name: 'O' };
const acme = { id: 'w-acme', name: 'Acme Flowers', role: 'operator' as const };

function ctx(over: Partial<GuardContext> = {}): GuardContext {
  return {
    navigate: vi.fn(),
    currentAddress: () => '/w/w-acme/inbox',
    resolveWorkspaces: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => {
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
  useAuthStore.getState().setAccount(account);
  useWorkspaceStore.getState().setCurrent(acme);
  useWorkspaceStore.getState().setData('members', [1]);
});

describe('handleGuardError', () => {
  it('401: clears both stores, remembers the address, goes to sign-in session-ended', async () => {
    const c = ctx();
    const r = await handleGuardError(new ApiError(401, ErrorCode.UNAUTHENTICATED, 'x'), c);
    expect(r).toBe('handled');
    expect(useAuthStore.getState().account).toBeNull();
    expect(useWorkspaceStore.getState().current).toBeNull();
    expect(useAuthStore.getState().returnTo).toBe('/w/w-acme/inbox');
    expect(c.navigate).toHaveBeenCalledWith('/sign-in', { reason: 'session-ended' });
  });

  it('401 on an inbox address with lenses remembers path and lenses (AC-11)', async () => {
    const address = '/w/w-acme/inbox?status=closed&assignee=mine';
    const c = { ...ctx(), currentAddress: () => address };
    await handleGuardError(new ApiError(401, ErrorCode.UNAUTHENTICATED, 'x'), c);
    expect(useAuthStore.getState().returnTo).toBe(address);
  });

  it('403 ACCESS_REMOVED: clears workspace data BEFORE the resolver runs, keeps the account', async () => {
    let seenAtResolve: unknown;
    const c = ctx({
      resolveWorkspaces: vi.fn(async () => {
        const s = useWorkspaceStore.getState();
        seenAtResolve = { current: s.current, data: s.data, notice: s.accessRemovedNotice };
      }),
    });
    const r = await handleGuardError(new ApiError(403, ErrorCode.ACCESS_REMOVED, 'x'), c, 'w-acme');
    expect(r).toBe('handled');
    expect(seenAtResolve).toEqual({
      current: null,
      data: {},
      notice: { workspaceId: 'w-acme', name: 'Acme Flowers' },
    });
    expect(useAuthStore.getState().account).toEqual(account);
    expect(c.resolveWorkspaces).toHaveBeenCalledOnce();
  });

  it('403 ACCESS_REMOVED for another workspace leaves the current one alone', async () => {
    await handleGuardError(new ApiError(403, ErrorCode.ACCESS_REMOVED, 'x'), ctx(), 'w-other');
    expect(useWorkspaceStore.getState().current).toEqual(acme);
  });

  it('403 ACCESS_REMOVED with no current workspace still sets a notice (AC-17)', async () => {
    useWorkspaceStore.getState().clear();
    const c = ctx();
    const r = await handleGuardError(new ApiError(403, ErrorCode.ACCESS_REMOVED, 'x'), c, 'w-acme');
    expect(r).toBe('handled');
    expect(useWorkspaceStore.getState().accessRemovedNotice).toEqual({
      workspaceId: 'w-acme',
      name: 'this workspace',
    });
    expect(c.resolveWorkspaces).toHaveBeenCalledOnce();
  });

  it('403 ACCESS_REMOVED with nothing entered keeps the notice for the same workspace (Retry)', async () => {
    useWorkspaceStore.getState().clear();
    useWorkspaceStore
      .getState()
      .setAccessRemovedNotice({ workspaceId: 'w-acme', name: 'Acme Flowers' });
    await handleGuardError(new ApiError(403, ErrorCode.ACCESS_REMOVED, 'x'), ctx(), 'w-acme');
    expect(useWorkspaceStore.getState().accessRemovedNotice).toEqual({
      workspaceId: 'w-acme',
      name: 'Acme Flowers',
    });
  });

  it('403 ACCESS_REMOVED for a never-entered workspace replaces an older notice (X1)', async () => {
    useWorkspaceStore.getState().clear();
    useWorkspaceStore
      .getState()
      .setAccessRemovedNotice({ workspaceId: 'w-acme', name: 'Acme Flowers' });
    await handleGuardError(new ApiError(403, ErrorCode.ACCESS_REMOVED, 'x'), ctx(), 'w-cozy');
    expect(useWorkspaceStore.getState().accessRemovedNotice).toEqual({
      workspaceId: 'w-cozy',
      name: 'this workspace',
    });
  });

  it('404: signals render-in-place', async () => {
    const r = await handleGuardError(new ApiError(404, ErrorCode.NOT_FOUND, 'x'), ctx());
    expect(r).toBe('not-found');
  });

  it('403 OWNER_ONLY, 500 and network errors are rethrown', async () => {
    for (const e of [
      new ApiError(403, ErrorCode.OWNER_ONLY, 'x'),
      new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'),
      new TypeError('Failed to fetch'),
    ]) {
      await expect(handleGuardError(e, ctx())).rejects.toBe(e);
    }
  });
});
