import { WorkspaceSummaryPage } from '@tg/shared';
import { apiRequest } from '@/shared/api/client';

export const listMyWorkspaces = () =>
  apiRequest('/api/me/workspaces?limit=100', WorkspaceSummaryPage);
