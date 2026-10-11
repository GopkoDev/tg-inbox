import { z } from 'zod';
import { EmailInput, LinkToken, Password } from './workspaces.js';

/** Sign-in carries no password policy hint: 1–1024 chars only. */
export const SignIn = z.strictObject({
  email: EmailInput,
  password: z.string().min(1).max(1024),
});
export type SignIn = z.infer<typeof SignIn>;

export const LinkTokenBody = z.strictObject({ token: LinkToken });
export type LinkTokenBody = z.infer<typeof LinkTokenBody>;

export const PasswordResetRedeem = z.strictObject({
  token: LinkToken,
  password: Password,
});
export type PasswordResetRedeem = z.infer<typeof PasswordResetRedeem>;
