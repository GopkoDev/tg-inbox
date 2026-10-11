export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 1024;

export type PasswordCheck = { ok: true } | { ok: false; field: 'password'; message: string };

export function checkPasswordPolicy(password: string): PasswordCheck {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      field: 'password',
      message: `The password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
    };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      field: 'password',
      message: `The password must be at most ${PASSWORD_MAX_LENGTH} characters long`,
    };
  }
  return { ok: true };
}
