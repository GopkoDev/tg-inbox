import {
  InvitationPreview,
  Me,
  WorkspaceSummary,
  type InvitationAccept,
  type SignIn,
} from '@tg/shared';
import { apiRequest } from '@/shared/api/client';

export const getMe = () => apiRequest('/api/me', Me);

export const signIn = (body: SignIn) =>
  apiRequest('/api/auth/sign-in', undefined, { method: 'POST', body: JSON.stringify(body) });

export const signOut = () => apiRequest('/api/auth/sign-out', undefined, { method: 'POST' });

export const lookUpInvitation = (token: string) =>
  apiRequest('/api/invitations/lookup', InvitationPreview, {
    method: 'POST',
    body: JSON.stringify({ token }),
  });

export const acceptInvitation = (body: InvitationAccept) =>
  apiRequest('/api/invitations/accept', WorkspaceSummary, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const enterWorkspace = (workspaceId: string) =>
  apiRequest(`/api/workspaces/${workspaceId}/enter`, WorkspaceSummary, { method: 'POST' });
