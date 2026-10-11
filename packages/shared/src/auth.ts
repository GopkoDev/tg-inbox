import { z } from 'zod';
import { CurrentPassword, EmailInput, LinkToken, Password } from './workspaces.js';

/** Sign-in carries no password policy hint: 1–1024 chars only (the shared `CurrentPassword`). */
export const SignIn = z.strictObject({
  email: EmailInput,
  password: CurrentPassword,
});
export type SignIn = z.infer<typeof SignIn>;

export const LinkTokenBody = z.strictObject({ token: LinkToken });
export type LinkTokenBody = z.infer<typeof LinkTokenBody>;

export const PasswordResetRedeem = z.strictObject({
  token: LinkToken,
  password: Password,
});
export type PasswordResetRedeem = z.infer<typeof PasswordResetRedeem>;
