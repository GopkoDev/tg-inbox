import {
  Membership,
  MembershipPage,
  PendingInvitationPage,
  WorkspaceSummary,
  WorkspaceSummaryPage,
} from '@tg/shared';
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

const ws = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}`;
const paging = (after?: string) =>
  `?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;

export const listMemberships = (workspaceId: string, after?: string) =>
  apiRequest(`${ws(workspaceId)}/memberships${paging(after)}`, MembershipPage);

export const listPendingInvitations = (workspaceId: string, after?: string) =>
  apiRequest(`${ws(workspaceId)}/invitations${paging(after)}`, PendingInvitationPage);

export const deactivateMembership = (workspaceId: string, membershipId: string) =>
  apiRequest(
    `${ws(workspaceId)}/memberships/${encodeURIComponent(membershipId)}/deactivate`,
    Membership,
    { method: 'POST' },
  );

export const reactivateMembership = (workspaceId: string, membershipId: string) =>
  apiRequest(
    `${ws(workspaceId)}/memberships/${encodeURIComponent(membershipId)}/reactivate`,
    Membership,
    { method: 'POST' },
  );

export const revokeInvitation = (workspaceId: string, invitationId: string) =>
  apiRequest(
    `${ws(workspaceId)}/invitations/${encodeURIComponent(invitationId)}/revoke`,
    undefined,
    { method: 'POST' },
  );
