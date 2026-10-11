import { WorkspaceSummary, WorkspaceSummaryPage } from '@tg/shared';
import { apiRequest } from '@/shared/api/client';

export const listMyWorkspaces = (after?: string) =>
  apiRequest(
    `/api/me/workspaces?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`,
    WorkspaceSummaryPage,
  );

/** Opens a workspace: checks the membership and records it as the last used one. */
export const enterWorkspace = (workspaceId: string) =>
  apiRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/enter`, WorkspaceSummary, {
    method: 'POST',
  });
