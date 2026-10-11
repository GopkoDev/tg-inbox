import { Me, type SignIn } from '@tg/shared';
import { apiRequest } from '@/shared/api/client';

export const getMe = () => apiRequest('/api/me', Me);

export const signIn = (body: SignIn) =>
  apiRequest('/api/auth/sign-in', undefined, { method: 'POST', body: JSON.stringify(body) });

export const signOut = () => apiRequest('/api/auth/sign-out', undefined, { method: 'POST' });
