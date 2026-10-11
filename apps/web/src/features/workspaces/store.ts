import type { WorkspaceSummary } from '@tg/shared';
import { create } from 'zustand';

/** The workspace whose access was just removed, and the name to show for it. */
export interface AccessRemovedNotice {
  workspaceId: string;
  name: string;
}

interface WorkspaceState {
  current: WorkspaceSummary | null;
  /** Loaded data slots of the current workspace, keyed by feature. */
  data: Record<string, unknown>;
  /** The workspace whose access was just removed (shown once on the landing screen). */
  accessRemovedNotice: AccessRemovedNotice | null;
  setCurrent: (workspace: WorkspaceSummary) => void;
  setData: (key: string, value: unknown) => void;
  setAccessRemovedNotice: (notice: AccessRemovedNotice | null) => void;
  /** Drop the workspace's data at once; no-op when `id` is not the current workspace. */
  clearWorkspace: (id: string) => void;
  clear: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  current: null,
  data: {},
  accessRemovedNotice: null,
  setCurrent: (current) => set({ current, data: {} }),
  setData: (key, value) => set((s) => ({ data: { ...s.data, [key]: value } })),
  setAccessRemovedNotice: (accessRemovedNotice) => set({ accessRemovedNotice }),
  clearWorkspace: (id) => set((s) => (s.current?.id === id ? { current: null, data: {} } : s)),
  clear: () => set({ current: null, data: {}, accessRemovedNotice: null }),
}));
