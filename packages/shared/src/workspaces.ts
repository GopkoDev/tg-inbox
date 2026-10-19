import { z } from 'zod';

export const EMAIL_MESSAGE = 'Enter a valid email address';
export const PASSWORD_MESSAGE = 'The password must be at least 10 characters long';
export const PASSWORD_MAX_MESSAGE = 'The password must be at most 1024 characters long';
export const PASSWORD_REQUIRED_MESSAGE = 'Enter your password';
export const DISPLAY_NAME_MESSAGE = 'Enter your name (up to 200 characters)';

/** Email as typed by a person: trimmed and lower-cased first, then validated (spec §6.1). */
export const EmailInput = z
  .string()
  .max(320)
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: EMAIL_MESSAGE }).min(3, EMAIL_MESSAGE).max(254, EMAIL_MESSAGE));
export type EmailInput = z.infer<typeof EmailInput>;

/** Already-normalised email as returned by the API. */
export const Email = z.string().min(3).max(254);
export type Email = z.infer<typeof Email>;

export const Password = z.string().min(10, PASSWORD_MESSAGE).max(1024, PASSWORD_MAX_MESSAGE);
export type Password = z.infer<typeof Password>;

/** Only the upper bound: an existing account's password on accept is checked by verifying it. */
export const PasswordBound = z.string().max(1024, PASSWORD_MAX_MESSAGE);
export type PasswordBound = z.infer<typeof PasswordBound>;

/** The password of an existing account at sign-in: required, no policy minimum. */
export const CurrentPassword = z
  .string()
  .min(1, PASSWORD_REQUIRED_MESSAGE)
  .max(1024, PASSWORD_MAX_MESSAGE);
export type CurrentPassword = z.infer<typeof CurrentPassword>;

export const DisplayName = z
  .string()
  .trim()
  .min(1, DISPLAY_NAME_MESSAGE)
  .max(200, DISPLAY_NAME_MESSAGE);
export type DisplayName = z.infer<typeof DisplayName>;

export const WorkspaceName = z.string().trim().min(1).max(200);
export type WorkspaceName = z.infer<typeof WorkspaceName>;

export const Role = z.enum(['owner', 'operator']);
export type Role = z.infer<typeof Role>;

export const MembershipState = z.enum(['active', 'deactivated']);
export type MembershipState = z.infer<typeof MembershipState>;

export const LinkToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export type LinkToken = z.infer<typeof LinkToken>;

const DateTime = z.iso.datetime({ offset: true });

export const PageQuery = z.strictObject({
  after: z.uuid().optional(),
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof PageQuery>;

const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    has_next: z.boolean(),
    has_prev: z.boolean(),
    next_cursor: z.uuid().nullable(),
  });

export const Account = z.strictObject({
  id: z.uuid(),
  email: Email,
  display_name: z.string(),
});
export type Account = z.infer<typeof Account>;

export const Me = z.strictObject({
  account: Account,
  last_used_workspace_id: z.uuid().nullable(),
});
export type Me = z.infer<typeof Me>;

export const WorkspaceSummary = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  role: Role,
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummary>;
export const WorkspaceSummaryPage = page(WorkspaceSummary);
export type WorkspaceSummaryPage = z.infer<typeof WorkspaceSummaryPage>;

export const InvitationPreview = z.strictObject({
  workspace_name: z.string(),
  email: Email,
  role: Role,
  account_exists: z.boolean(),
});
export type InvitationPreview = z.infer<typeof InvitationPreview>;

/** The password is bound-only: the 10–1024 policy applies to a new account, in the use case (AC-05). */
export const InvitationAccept = z.strictObject({
  token: LinkToken,
  password: PasswordBound,
  display_name: DisplayName.optional(),
});
export type InvitationAccept = z.infer<typeof InvitationAccept>;

export const InvitationCreate = z.strictObject({
  email: EmailInput,
  role: Role,
});
export type InvitationCreate = z.infer<typeof InvitationCreate>;

/** A pending invitation as listed to the owner — never carries the link. */
export const PendingInvitation = z.strictObject({
  id: z.uuid(),
  email: Email,
  role: Role,
  created_at: DateTime,
  expires_at: DateTime,
});
export type PendingInvitation = z.infer<typeof PendingInvitation>;
export const PendingInvitationPage = page(PendingInvitation);
export type PendingInvitationPage = z.infer<typeof PendingInvitationPage>;

export const IssuedInvitation = z.strictObject({
  invitation: PendingInvitation,
  link: z.url(),
});
export type IssuedInvitation = z.infer<typeof IssuedInvitation>;

export const Membership = z.strictObject({
  id: z.uuid(),
  display_name: z.string(),
  email: Email,
  role: Role,
  state: MembershipState,
  created_at: DateTime,
  deactivated_at: DateTime.nullable(),
  /** True when the member has a live Telegram link in this workspace; never the Telegram account itself. */
  telegram_pings: z.boolean(),
});
export type Membership = z.infer<typeof Membership>;
export const MembershipPage = page(Membership);
export type MembershipPage = z.infer<typeof MembershipPage>;
