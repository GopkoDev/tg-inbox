import {
  InvitationPreview,
  Me,
  WorkspaceSummary,
  type InvitationAccept,
  type PasswordResetRedeem,
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

export const lookUpPasswordResetLink = (token: string) =>
  apiRequest('/api/password-reset-links/lookup', undefined, {
    method: 'POST',
    body: JSON.stringify({ token }),
  });

export const redeemPasswordResetLink = (body: PasswordResetRedeem) =>
  apiRequest('/api/password-reset-links/redeem', undefined, {
    method: 'POST',
    body: JSON.stringify(body),
  });
