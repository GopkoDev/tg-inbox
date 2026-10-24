import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  Broadcast,
  BroadcastAudienceSave,
  BroadcastCreate,
  BroadcastDeleted,
  BroadcastDraft,
  BroadcastDuplicate,
  BroadcastFieldsSave,
  BroadcastGroupAdd,
  BroadcastGroupAddMatching,
  BroadcastGroupChange,
  BroadcastGroupMatching,
  BroadcastGroupMatchingAdded,
  BroadcastGroupMembership,
  BroadcastGroupPage,
  BroadcastLaunch,
  BroadcastLaunched,
  BroadcastList,
  BroadcastRecipientPage,
  BroadcastStopped,
  Cursor,
  LaunchConfirmation,
  RecipientState,
  TagFilterMode,
} from '@tg/shared';
import {
  createWorkspaceGuard,
  ownerOnly,
  type WorkspaceGuardDeps,
} from '../../workspaces/http/guard.js';
import type { Drafts } from '../app/drafts.js';
import type { Duplicate } from '../app/duplicate.js';
import type { BroadcastGroup } from '../app/group.js';
import type { LaunchBroadcast } from '../app/launch.js';
import type { LaunchPreview } from '../app/preview.js';
import type { BroadcastReads } from '../app/reads.js';
import type { StopBroadcast } from '../app/stop.js';

export interface BroadcastsDeps {
  reads: Pick<BroadcastReads, 'listBroadcasts' | 'getBroadcast' | 'listRecipients'>;
  drafts: Drafts;
  group: BroadcastGroup;
  duplicate: Duplicate;
  preview: Pick<LaunchPreview, 'getLaunchConfirmation'>;
  launch: LaunchBroadcast;
  stop: StopBroadcast;
  /** The workspaces guard dependency (membership check on every request). */
  access: WorkspaceGuardDeps;
  /** The auth module's session resolver (preHandler setting `request.account`). */
  authenticate: preHandlerAsyncHookHandler;
}

/** The `OWNER_ONLY` message of the launch confirmation, the launch and the stop (AC-07, AC-18). */
export const OWNER_ONLY_BROADCASTS = 'Only a business owner launches and stops broadcasts';

const Id = z.uuid();
// The schemas keep `workspaceId`: the guard reads it from the params, and a malformed one is its 404.
const workspace = { workspaceId: z.string() };
const broadcast = { ...workspace, broadcastId: Id };
const groupContact = { ...broadcast, contactId: Id };
const many = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(item));

/** `GET …/group/matching`: the Contacts list's search and tag filter (`q` is masked in logs). */
const MatchingQuery = z
  .strictObject({
    q: z.string().max(200).optional(),
    mode: TagFilterMode.default('any'),
    tag: many(Id).pipe(z.array(Id).max(100)).optional(),
  })
  .superRefine((query, ctx) => {
    if (query.mode === 'none' && query.tag !== undefined && query.tag.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['tag'], message: 'mode none takes no tag' });
    }
  });

/**
 * The broadcasts routes under `/workspaces/:workspaceId` (openapi.yaml); the caller supplies the
 * `/api` prefix. Any active member lists, reads, creates, edits, duplicates and changes groups; the
 * delete's author-or-owner rule lives in the use case; the launch confirmation, the launch and the
 * stop are owner-only here and re-checked under the membership lock in their use cases.
 */
export async function registerBroadcasts(
  app: FastifyInstance,
  deps: BroadcastsDeps,
): Promise<void> {
  const { reads, drafts, group, duplicate, preview, launch, stop, access, authenticate } = deps;
  const member = [authenticate, createWorkspaceGuard(access)];
  const owner = [...member, ownerOnly(OWNER_ONLY_BROADCASTS)];
  const r = app.withTypeProvider<ZodTypeProvider>();
  const base = '/workspaces/:workspaceId/broadcasts';
  const one = `${base}/:broadcastId`;
  const actor = (request: {
    account: { id: string };
    workspace: { role: 'owner' | 'operator' };
  }) => ({ accountId: request.account.id, role: request.workspace.role });

  r.get(
    base,
    { preHandler: member, schema: { response: { 200: BroadcastList } } },
    async (request) => reads.listBroadcasts(request.workspace.workspaceId),
  );

  r.post(
    base,
    {
      preHandler: member,
      schema: {
        params: z.object(workspace),
        body: BroadcastCreate,
        response: { 201: BroadcastDraft },
      },
    },
    async (request, reply) => {
      const draft = await drafts.createDraft(
        request.workspace.workspaceId,
        request.account.id,
        request.body,
      );
      return reply.code(201).send(draft);
    },
  );

  r.get(
    one,
    {
      preHandler: member,
      schema: { params: z.object(broadcast), response: { 200: Broadcast } },
    },
    async (request) =>
      reads.getBroadcast(request.workspace.workspaceId, request.params.broadcastId),
  );

  r.post(
    `${one}/save`,
    {
      preHandler: member,
      schema: {
        params: z.object(broadcast),
        body: BroadcastFieldsSave,
        response: { 200: BroadcastDraft },
      },
    },
    async (request) =>
      drafts.saveFields(
        request.workspace.workspaceId,
        request.account.id,
        request.params.broadcastId,
        request.body,
      ),
  );

  r.post(
    `${one}/audience`,
    {
      preHandler: member,
      schema: {
        params: z.object(broadcast),
        body: BroadcastAudienceSave,
        response: { 200: BroadcastDraft },
      },
    },
    async (request) =>
      drafts.saveAudience(
        request.workspace.workspaceId,
        request.account.id,
        request.params.broadcastId,
        request.body,
      ),
  );

  r.get(
    `${one}/group`,
    {
      preHandler: member,
      schema: {
        params: z.object(broadcast),
        querystring: z.strictObject({ after: Cursor.optional() }),
        response: { 200: BroadcastGroupPage },
      },
    },
    async (request) =>
      group.groupPage(
        request.workspace.workspaceId,
        request.params.broadcastId,
        request.query.after,
      ),
  );

  r.get(
    `${one}/group/membership`,
    {
      preHandler: member,
      schema: {
        params: z.object(broadcast),
        querystring: z.strictObject({ contact: many(Id).pipe(z.array(Id).min(1).max(50)) }),
        response: { 200: BroadcastGroupMembership },
      },
    },
    async (request) =>
      group.membership(
        request.workspace.workspaceId,
        request.params.broadcastId,
        request.query.contact,
      ),
  );

  r.post(
    `${one}/group/contacts`,
    {
      preHandler: member,
      schema: {
        params: z.object(broadcast),
        body: BroadcastGroupAdd,
        response: { 200: BroadcastGroupChange },
      },
    },
    async (request) =>
      group.addContact(
        request.workspace.workspaceId,
        request.account.id,
        request.params.broadcastId,
        request.body.contact_id,
      ),
  );

  r.post(
    `${one}/group/contacts/:contactId/remove`,
    {
      preHandler: member,
      schema: { params: z.object(groupContact), response: { 200: BroadcastGroupChange } },
    },
    async (request) =>
      group.removeContact(
        request.workspace.workspaceId,
        request.account.id,
        request.params.broadcastId,
        request.params.contactId,
      ),
  );

  r.get(
    `${one}/group/matching`,
    {
      preHandler: member,
      schema: {
        params: z.object(broadcast),
        querystring: MatchingQuery,
        response: { 200: BroadcastGroupMatching },
      },
    },
    async (request) =>
      group.countMatching(request.workspace.workspaceId, request.params.broadcastId, {
        q: request.query.q ?? null,
        mode: request.query.mode,
        tagIds: request.query.tag ?? [],
      }),
  );

  r.post(
    `${one}/group/add-matching`,
    {
      preHandler: member,
      schema: {
        params: z.object(broadcast),
        body: BroadcastGroupAddMatching,
        response: { 200: BroadcastGroupMatchingAdded },
      },
    },
    async (request) =>
      group.addMatching(
        request.workspace.workspaceId,
        request.account.id,
        request.params.broadcastId,
        request.body,
      ),
  );

  r.post(
    `${one}/delete`,
    {
      preHandler: member,
      schema: { params: z.object(broadcast), response: { 200: BroadcastDeleted } },
    },
    async (request) =>
      drafts.deleteDraft(request.workspace.workspaceId, actor(request), request.params.broadcastId),
  );

  r.post(
    `${one}/duplicate`,
    {
      preHandler: member,
      schema: {
        params: z.object(broadcast),
        body: BroadcastDuplicate,
        response: { 201: BroadcastDraft },
      },
    },
    async (request, reply) => {
      const copy = await duplicate.duplicateBroadcast(
        request.workspace.workspaceId,
        request.account.id,
        request.params.broadcastId,
        request.body,
      );
      return reply.code(201).send(copy);
    },
  );

  r.get(
    `${one}/launch-confirmation`,
    {
      preHandler: owner,
      schema: { params: z.object(broadcast), response: { 200: LaunchConfirmation } },
    },
    async (request) =>
      preview.getLaunchConfirmation(
        request.workspace.workspaceId,
        actor(request),
        request.params.broadcastId,
      ),
  );

  r.post(
    `${one}/launch`,
    {
      preHandler: owner,
      schema: {
        params: z.object(broadcast),
        body: BroadcastLaunch,
        response: { 200: BroadcastLaunched },
      },
    },
    async (request) =>
      launch.launchBroadcast(
        request.workspace.workspaceId,
        actor(request),
        request.params.broadcastId,
        request.body,
      ),
  );

  r.post(
    `${one}/stop`,
    {
      preHandler: owner,
      schema: { params: z.object(broadcast), response: { 200: BroadcastStopped } },
    },
    async (request) =>
      stop.stopBroadcast(request.workspace.workspaceId, actor(request), request.params.broadcastId),
  );

  r.get(
    `${one}/recipients`,
    {
      preHandler: member,
      schema: {
        params: z.object(broadcast),
        querystring: z.strictObject({ state: RecipientState.optional(), after: Cursor.optional() }),
        response: { 200: BroadcastRecipientPage },
      },
    },
    async (request) =>
      reads.listRecipients(request.workspace.workspaceId, request.params.broadcastId, {
        ...(request.query.state && { state: request.query.state }),
        ...(request.query.after && { after: request.query.after }),
      }),
  );
}
