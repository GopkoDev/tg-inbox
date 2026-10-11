import type { WorkspaceSummary } from '@tg/shared';
import { create } from 'zustand';

interface WorkspaceState {
  current: WorkspaceSummary | null;
  /** Loaded data slots of the current workspace, keyed by feature. */
  data: Record<string, unknown>;
  /** Name of the workspace whose access was just removed (shown once on the landing screen). */
  accessRemovedNotice: string | null;
  setCurrent: (workspace: WorkspaceSummary) => void;
  setData: (key: string, value: unknown) => void;
  setAccessRemovedNotice: (name: string | null) => void;
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
