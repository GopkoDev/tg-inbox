import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './store';

describe('address workspace (the shell guard scope)', () => {
  beforeEach(() => useWorkspaceStore.getState().clear());

  it('is reset by clear() (sign-out / session end)', () => {
    useWorkspaceStore.getState().setAddressWorkspace('w1');
    useWorkspaceStore.getState().clear();
    expect(useWorkspaceStore.getState().addressWorkspaceId).toBeNull();
  });

  it('is released only by the shell that still holds it', () => {
    useWorkspaceStore.getState().setAddressWorkspace('w2');
    useWorkspaceStore.getState().releaseAddressWorkspace('w1');
    expect(useWorkspaceStore.getState().addressWorkspaceId).toBe('w2');
    useWorkspaceStore.getState().releaseAddressWorkspace('w2');
    expect(useWorkspaceStore.getState().addressWorkspaceId).toBeNull();
  });
});
