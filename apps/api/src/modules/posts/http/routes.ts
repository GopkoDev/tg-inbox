import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  DestinationCodeCreated,
  DestinationCodeStatus,
  DestinationList,
  DestinationRemoved,
  ExpectedVersion,
  Outcome,
  Post,
  PostAttention,
  PostCreate,
  PostList,
  PostOutcome,
  PostSave,
  PostSchedule,
  PostScheduled,
  PublishConfirmation,
  TimeZoneSaved,
  TimeZoneSet,
} from '@tg/shared';
import {
  createWorkspaceGuard,
  ownerOnly,
  type WorkspaceGuardDeps,
} from '../../workspaces/http/guard.js';
import type { Destinations } from '../app/destinations.js';
import type { DestinationReads } from '../app/destination-reads.js';
import type { PostDeletion } from '../app/delete-published.js';
import type { PostDrafts } from '../app/drafts.js';
import type { PostReads } from '../app/post-reads.js';
import type { PostPublishing } from '../app/publish.js';
import type { PostingTimeZone } from '../app/time-zone.js';

export interface PostsDeps {
  reads: PostReads;
  drafts: PostDrafts;
  publishing: PostPublishing;
  deletion: PostDeletion;
  destinations: Destinations;
  destinationReads: DestinationReads;
  timeZone: PostingTimeZone;
  /** The workspaces guard dependency (membership check on every request). */
  access: WorkspaceGuardDeps;
  /** The auth module's session resolver (preHandler setting `request.account`). */
  authenticate: preHandlerAsyncHookHandler;
}

/** The `OWNER_ONLY` message of the owner-only post and destination operations (AC-03). */
export const OWNER_ONLY_POSTS =
  'Only a business owner can connect or remove a destination, publish, schedule or delete a published post';

const Id = z.uuid();
// The schemas keep `workspaceId`: the guard reads it from the params, and a malformed one is its 404.
const workspace = { workspaceId: z.string() };
const onePost = { ...workspace, postId: Id };

const ListFilter = z.enum(['all', 'drafts', 'scheduled', 'published', 'attention']);

/**
 * The posts routes under `/workspaces/:workspaceId` (openapi.yaml); the caller supplies the `/api`
 * prefix. Any active member reads and drafts; destinations, the time zone, the publish
 * confirmation, publish, schedule and delete-from-Telegram are owner-only (re-checked under the
 * membership lock in the use cases).
 */
export async function registerPosts(app: FastifyInstance, deps: PostsDeps): Promise<void> {
  const {
    reads,
    drafts,
    publishing,
    deletion,
    destinations,
    destinationReads,
    timeZone,
    access,
    authenticate,
  } = deps;
  const member = [authenticate, createWorkspaceGuard(access)];
  const owner = [...member, ownerOnly(OWNER_ONLY_POSTS)];
  const r = app.withTypeProvider<ZodTypeProvider>();
  const base = '/workspaces/:workspaceId/posts';
  const one = `${base}/:postId`;
  const actor = (request: {
    account: { id: string };
    workspace: { role: 'owner' | 'operator' };
  }) => ({ accountId: request.account.id, role: request.workspace.role });

  r.get(
    `${base}/destinations`,
    {
      preHandler: member,
      schema: { params: z.object(workspace), response: { 200: DestinationList } },
    },
    async (request) => destinationReads.listDestinations(request.workspace.workspaceId),
  );

  r.post(
    `${base}/destinations/connect-codes`,
    {
      preHandler: owner,
      schema: { params: z.object(workspace), response: { 201: DestinationCodeCreated } },
    },
    async (request, reply) => {
      const created = await destinations.createCode(request.workspace.workspaceId, actor(request));
      return reply.code(201).send(created);
    },
  );

  r.get(
    `${base}/destinations/connect-codes/:codeId`,
    {
      preHandler: member,
      schema: {
        params: z.object({ ...workspace, codeId: Id }),
        response: { 200: DestinationCodeStatus },
      },
    },
    async (request) =>
      destinations.getCode(request.workspace.workspaceId, actor(request), request.params.codeId),
  );

  r.post(
    `${base}/destinations/:destinationId/remove`,
    {
      preHandler: owner,
      schema: {
        params: z.object({ ...workspace, destinationId: Id }),
        response: { 200: DestinationRemoved },
      },
    },
    async (request) =>
      destinations.removeDestination(
        request.workspace.workspaceId,
        actor(request),
        request.params.destinationId,
      ),
  );

  r.post(
    `${base}/time-zone`,
    {
      preHandler: owner,
      schema: {
        params: z.object(workspace),
        body: TimeZoneSet,
        response: { 200: TimeZoneSaved },
      },
    },
    async (request) =>
      timeZone.setTimeZone(request.workspace.workspaceId, actor(request), request.body.time_zone),
  );

  r.get(
    base,
    {
      preHandler: member,
      schema: {
        params: z.object(workspace),
        querystring: z.object({ filter: ListFilter.default('all') }),
        response: { 200: PostList },
      },
    },
    async (request) => {
      const list = await reads.listPosts(request.workspace.workspaceId, {});
      const keep: Record<z.infer<typeof ListFilter>, (i: PostList['items'][number]) => boolean> = {
        all: () => true,
        drafts: (i) => i.state === 'draft',
        scheduled: (i) => i.state === 'scheduled' || i.state === 'sending',
        published: (i) => i.state === 'published' || i.state === 'deleted',
        attention: (i) => i.needs_attention,
      };
      return { ...list, items: list.items.filter(keep[request.query.filter]) };
    },
  );

  r.post(
    base,
    {
      preHandler: member,
      schema: { params: z.object(workspace), body: PostCreate, response: { 201: Post } },
    },
    async (request, reply) => {
      const draft = await drafts.createPost(
        request.workspace.workspaceId,
        request.account.id,
        request.body,
      );
      return reply.code(201).send(draft);
    },
  );

  r.get(
    `${base}/attention`,
    {
      preHandler: member,
      schema: { params: z.object(workspace), response: { 200: PostAttention } },
    },
    async (request) => reads.getPostAttention(request.workspace.workspaceId),
  );

  r.get(
    one,
    { preHandler: member, schema: { params: z.object(onePost), response: { 200: Post } } },
    async (request) => reads.getPost(request.workspace.workspaceId, request.params.postId),
  );

  r.post(
    `${one}/save`,
    {
      preHandler: member,
      schema: { params: z.object(onePost), body: PostSave, response: { 200: Post } },
    },
    async (request) =>
      drafts.savePost(
        request.workspace.workspaceId,
        request.account.id,
        request.params.postId,
        request.body,
      ),
  );

  r.post(
    `${one}/duplicate`,
    { preHandler: member, schema: { params: z.object(onePost), response: { 201: Post } } },
    async (request, reply) => {
      const copy = await drafts.duplicatePost(
        request.workspace.workspaceId,
        request.account.id,
        request.params.postId,
      );
      return reply.code(201).send(copy);
    },
  );

  r.post(
    `${one}/delete`,
    { preHandler: member, schema: { params: z.object(onePost), response: { 200: Outcome } } },
    async (request) =>
      drafts.deletePostDraft(request.workspace.workspaceId, actor(request), request.params.postId),
  );

  r.get(
    `${one}/publish-confirmation`,
    {
      preHandler: owner,
      schema: { params: z.object(onePost), response: { 200: PublishConfirmation } },
    },
    async (request) =>
      publishing.getPublishConfirmation(
        request.workspace.workspaceId,
        actor(request),
        request.params.postId,
      ),
  );

  r.post(
    `${one}/publish`,
    {
      preHandler: owner,
      schema: {
        params: z.object(onePost),
        body: ExpectedVersion,
        response: { 200: PostScheduled },
      },
    },
    async (request) =>
      publishing.publishPost(
        request.workspace.workspaceId,
        actor(request),
        request.params.postId,
        request.body,
      ),
  );

  r.post(
    `${one}/schedule`,
    {
      preHandler: owner,
      schema: { params: z.object(onePost), body: PostSchedule, response: { 200: PostScheduled } },
    },
    async (request) =>
      publishing.schedulePost(
        request.workspace.workspaceId,
        actor(request),
        request.params.postId,
        request.body,
      ),
  );

  r.post(
    `${one}/back-to-draft`,
    {
      preHandler: member,
      schema: { params: z.object(onePost), body: ExpectedVersion, response: { 200: PostOutcome } },
    },
    async (request) => {
      const post = await drafts.movePostBackToDraft(
        request.workspace.workspaceId,
        request.account.id,
        request.params.postId,
      );
      return { outcome: 'changed' as const, post };
    },
  );

  r.post(
    `${one}/delete-from-telegram`,
    { preHandler: owner, schema: { params: z.object(onePost), response: { 200: PostOutcome } } },
    async (request) => {
      const post = await deletion.deletePostFromTelegram(
        request.workspace.workspaceId,
        actor(request),
        request.params.postId,
      );
      return { outcome: 'changed' as const, post };
    },
  );

  r.post(
    `${one}/seen`,
    { preHandler: member, schema: { params: z.object(onePost), response: { 200: Outcome } } },
    async (request) => reads.markPostSeen(request.workspace.workspaceId, request.params.postId),
  );
}
