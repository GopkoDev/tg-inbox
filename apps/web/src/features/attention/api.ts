import { AttentionCount } from '@tg/shared';
import { apiRequest } from '@/shared/api/client';

/**
 * The caller's attention count in the workspace (getAttentionCount). Always a background request:
 * the frame reads it on its own, so it must not extend the session's idle window.
 */
export const getAttentionCount = (workspaceId: string) =>
  apiRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/inbox/attention`, AttentionCount, {
    background: true,
  });
