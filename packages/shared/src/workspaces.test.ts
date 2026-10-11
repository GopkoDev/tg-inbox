import { describe, expect, it } from 'vitest';
import {
  DisplayName,
  Email,
  EmailInput,
  InvitationAccept,
  InvitationCreate,
  IssuedInvitation,
  Membership,
  MembershipPage,
  PageQuery,
  Password,
  PendingInvitation,
  WorkspaceName,
} from './index.js';

const uuid = '0190f3a0-0000-7000-8000-000000000001';
const now = '2026-01-01T00:00:00.000Z';

describe('value types', () => {
  it('EmailInput trims and lower-cases', () => {
    expect(EmailInput.parse('  Bob@X.com ')).toBe('bob@x.com');
  });
  it('EmailInput rejects garbage with the email message', () => {
    const r = EmailInput.safeParse('not-an-email');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('Enter a valid email address');
  });
  it('Email accepts normalised', () => {
    expect(Email.parse('a@b.co')).toBe('a@b.co');
  });
  it('WorkspaceName rejects blank and >200, trims', () => {
    expect(WorkspaceName.safeParse('   ').success).toBe(false);
    expect(WorkspaceName.safeParse('x'.repeat(201)).success).toBe(false);
    expect(WorkspaceName.parse('  Acme ')).toBe('Acme');
  });
  it('DisplayName rejects blank', () => {
    expect(DisplayName.safeParse(' ').success).toBe(false);
    expect(DisplayName.parse(' Bob ')).toBe('Bob');
  });
  it('Password bounds', () => {
    const short = Password.safeParse('x'.repeat(9));
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.message).toBe(
      'The password must be at least 10 characters long',
    );
    expect(Password.safeParse('x'.repeat(10)).success).toBe(true);
    expect(Password.safeParse('x'.repeat(1024)).success).toBe(true);
    expect(Password.safeParse('x'.repeat(1025)).success).toBe(false);
  });
});

describe('invitations', () => {
  it('InvitationCreate normalises email', () => {
    expect(InvitationCreate.parse({ email: ' A@B.com', role: 'owner' }).email).toBe('a@b.com');
    expect(InvitationCreate.safeParse({ email: 'a@b.com', role: 'admin' }).success).toBe(false);
  });
  it('InvitationAccept enforces 10-char password', () => {
    const token = 'a'.repeat(43);
    expect(InvitationAccept.safeParse({ token, password: 'short' }).success).toBe(false);
    expect(InvitationAccept.safeParse({ token, password: 'longenough1' }).success).toBe(true);
  });
  it('PendingInvitation has no link', () => {
    const base = { id: uuid, email: 'a@b.co', role: 'operator', created_at: now, expires_at: now };
    expect(PendingInvitation.safeParse(base).success).toBe(true);
    expect(PendingInvitation.safeParse({ ...base, link: 'https://x.y/z' }).success).toBe(false);
    expect(PendingInvitation.safeParse({ ...base, token: 'x' }).success).toBe(false);
  });
  it('IssuedInvitation carries a uri link', () => {
    const invitation = {
      id: uuid,
      email: 'a@b.co',
      role: 'operator',
      created_at: now,
      expires_at: now,
    };
    expect(IssuedInvitation.safeParse({ invitation, link: 'https://x.y/invite/t' }).success).toBe(
      true,
    );
    expect(IssuedInvitation.safeParse({ invitation, link: 'nope' }).success).toBe(false);
  });
});

describe('team list', () => {
  const m = {
    id: uuid,
    display_name: 'Bob',
    email: 'b@x.co',
    role: 'owner',
    state: 'active',
    created_at: now,
    deactivated_at: null,
  };
  it('Membership strict', () => {
    expect(Membership.safeParse(m).success).toBe(true);
    expect(Membership.safeParse({ ...m, link: 'x' }).success).toBe(false);
    expect(Membership.safeParse({ ...m, state: 'gone' }).success).toBe(false);
  });
  it('MembershipPage', () => {
    expect(
      MembershipPage.safeParse({ items: [m], has_next: false, has_prev: false, next_cursor: null })
        .success,
    ).toBe(true);
  });
  it('PageQuery limit', () => {
    expect(PageQuery.parse({}).limit).toBe(20);
    expect(PageQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(PageQuery.parse({ limit: '50' }).limit).toBe(50);
  });
});
