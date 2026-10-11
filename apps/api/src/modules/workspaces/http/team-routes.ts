import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  InvitationCreate,
  IssuedInvitation,
  Membership,
  MembershipPage,
  PageQuery,
  PendingInvitationPage,
} from '@tg/shared';
import type { MemberView, PendingInvitationView, Team } from '../app/team.js';
import { createWorkspaceGuard, ownerOnly, type WorkspaceGuardDeps } from './guard.js';

export interface TeamRoutesDeps {
  team: Pick<
    Team,
    | 'inviteMember'
    | 'revokeInvitation'
    | 'listMemberships'
    | 'listPendingInvitations'
    | 'deactivateMembership'
    | 'reactivateMembership'
  >;
  access: WorkspaceGuardDeps;
  authenticate: preHandlerAsyncHookHandler;
}

const WorkspaceParams = z.object({ workspaceId: z.string() });
const MembershipParams = WorkspaceParams.extend({ membershipId: z.string() });
const InvitationParams = WorkspaceParams.extend({ invitationId: z.string() });

const pending = (i: PendingInvitationView) => ({
  id: i.id,
  email: i.email,
  role: i.role,
  created_at: i.createdAt.toISOString(),
  expires_at: i.expiresAt.toISOString(),
});

const member = (m: MemberView) => ({
  id: m.id,
  display_name: m.displayName,
  email: m.email,
  role: m.role,
  state: m.state,
  created_at: m.createdAt.toISOString(),
  deactivated_at: m.deactivatedAt?.toISOString() ?? null,
});

const pageOf = <T, U>(
  p: { items: T[]; hasNext: boolean; hasPrev: boolean; nextCursor: string | null },
  map: (t: T) => U,
) => ({
  items: p.items.map(map),
  has_next: p.hasNext,
  has_prev: p.hasPrev,
  next_cursor: p.nextCursor,
});

/** The six owner-only team routes under `/workspaces/:workspaceId`; the caller supplies `/api`. */
export async function registerTeamRoutes(
  app: FastifyInstance,
  { team, access, authenticate }: TeamRoutesDeps,
): Promise<void> {
  const pre = [authenticate, createWorkspaceGuard(access), ownerOnly];
  const r = app.withTypeProvider<ZodTypeProvider>();
  const prefix = '/workspaces/:workspaceId';

  r.get(
    `${prefix}/memberships`,
    { preHandler: pre, schema: { querystring: PageQuery, response: { 200: MembershipPage } } },
    async (request) =>
      pageOf(await team.listMemberships(request.workspace.workspaceId, request.query), member),
  );

  r.post(
    `${prefix}/memberships/:membershipId/deactivate`,
    { preHandler: pre, schema: { params: MembershipParams, response: { 200: Membership } } },
    async (request) =>
      member(
        await team.deactivateMembership(request.workspace.workspaceId, request.params.membershipId),
      ),
  );

  r.post(
    `${prefix}/memberships/:membershipId/reactivate`,
    { preHandler: pre, schema: { params: MembershipParams, response: { 200: Membership } } },
    async (request) =>
      member(
        await team.reactivateMembership(request.workspace.workspaceId, request.params.membershipId),
      ),
  );

  r.get(
    `${prefix}/invitations`,
    {
      preHandler: pre,
      schema: { querystring: PageQuery, response: { 200: PendingInvitationPage } },
    },
    async (request) =>
      pageOf(
        await team.listPendingInvitations(request.workspace.workspaceId, request.query),
        pending,
      ),
  );

  r.post(
    `${prefix}/invitations`,
    { preHandler: pre, schema: { body: InvitationCreate, response: { 201: IssuedInvitation } } },
    async (request, reply) => {
      const issued = await team.inviteMember(request.workspace.workspaceId, request.body);
      return reply.code(201).send({ invitation: pending(issued.invitation), link: issued.link });
    },
  );

  r.post(
    `${prefix}/invitations/:invitationId/revoke`,
    { preHandler: pre, schema: { params: InvitationParams } },
    async (request, reply) => {
      await team.revokeInvitation(request.workspace.workspaceId, request.params.invitationId);
      return reply.code(204).send();
    },
  );
}
