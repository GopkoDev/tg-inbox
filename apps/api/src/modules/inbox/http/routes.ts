import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ActiveMemberList,
  AssigneeLens,
  ConversationPage,
  ConversationSummary,
  Cursor,
  InboxBotStatus,
  ReadMarkRequest,
  ReadState,
  ReplyResend,
  ReplySend,
  StatusLens,
  ThreadActivity,
  ThreadMessage,
  ThreadPage,
  ThreadReply,
} from '@tg/shared';
import { createWorkspaceGuard, type WorkspaceGuardDeps } from '../../workspaces/http/guard.js';
import type { InboxReadUseCases } from '../app/reads.js';
import type { OpenMessageMedia } from '../app/open-media.js';
import type { SendReplyUseCases } from '../app/send-reply.js';
import { ForbiddenError } from '../../../platform/errors.js';
import type { LiveHub } from '../infra/hub.js';

export interface InboxDeps {
  reads: InboxReadUseCases;
  replies: SendReplyUseCases;
  media: OpenMessageMedia;
  live: LiveHub;
  /** The panel's own origin (`PUBLIC_WEB_URL`); the only `Origin` a live socket may be opened from. */
  webOrigin: string;
  /** The workspaces guard dependency (membership check on every request). */
  access: WorkspaceGuardDeps;
  /** The auth module's session resolver (preHandler setting `request.account`). */
  authenticate: preHandlerAsyncHookHandler;
}

const Limit = z.coerce.number().int().min(1).max(100).default(50);
const workspace = { workspaceId: z.uuid() };
const conversation = { ...workspace, conversationId: z.uuid() };
// The text rules (blank, 4096 UTF-16 units) are answered by the use case with their own messages.
// A single byte range, forwarded to Telegram's file server (openapi.yaml, openMessageMedia).
const RangeHeader = z
  .string()
  .max(100)
  .regex(/^bytes=[0-9]*-[0-9]*$/);
const SendBody = ReplySend.extend({ body: z.string() });

/**
 * The inbox routes under `/workspaces/:workspaceId/inbox` (openapi.yaml); the caller supplies the
 * `/api` prefix. Operators and owners have the same rights, so there is no role check.
 */
export async function registerInbox(app: FastifyInstance, deps: InboxDeps): Promise<void> {
  const { reads, replies, media, live, webOrigin, access, authenticate } = deps;
  const pre = [authenticate, createWorkspaceGuard(access)];
  const r = app.withTypeProvider<ZodTypeProvider>();
  const base = '/workspaces/:workspaceId/inbox';
  const member = (request: { account: { id: string }; workspace: { activeSince: Date } }) => ({
    accountId: request.account.id,
    activeSince: request.workspace.activeSince,
  });

  // One socket per tab for one workspace (ADR-0002). Refusals are plain HTTP before the handshake.
  const requirePanelOrigin: preHandlerAsyncHookHandler = async (request) => {
    if (request.headers.origin !== webOrigin) throw new ForbiddenError('Forbidden');
  };
  r.get(
    `${base}/live`,
    {
      websocket: true,
      preHandler: [requirePanelOrigin, ...pre],
      schema: { params: z.object(workspace) },
    },
    (socket, request) => {
      const owner = {
        workspaceId: request.workspace.workspaceId,
        accountId: request.account.id,
        sessionId: request.sessionId,
      };
      live.attach(socket, owner);
      socket.on('close', () => live.detach(socket));
      socket.on('error', () => live.detach(socket));
      // The channel is server → client only: inbound frames are ignored.
      socket.on('message', () => undefined);
    },
  );

  r.get(
    `${base}/conversations`,
    {
      preHandler: pre,
      schema: {
        params: z.object(workspace),
        querystring: z.object({
          status: StatusLens.default('open'),
          assignee: AssigneeLens.default('all'),
          q: z.string().max(200).optional(),
          after: Cursor.optional(),
          limit: Limit,
        }),
        response: { 200: ConversationPage },
      },
    },
    async (request) =>
      reads.listConversations(request.workspace.workspaceId, member(request), request.query),
  );

  r.get(
    `${base}/conversations/:conversationId`,
    {
      preHandler: pre,
      schema: { params: z.object(conversation), response: { 200: ConversationSummary } },
    },
    async (request) =>
      reads.getConversation(
        request.workspace.workspaceId,
        member(request),
        request.params.conversationId,
      ),
  );

  r.get(
    `${base}/conversations/:conversationId/items`,
    {
      preHandler: pre,
      schema: {
        params: z.object(conversation),
        querystring: z.object({
          before: Cursor.optional(),
          after: Cursor.optional(),
          limit: Limit,
        }),
        response: { 200: ThreadPage },
      },
    },
    async (request) =>
      reads.listThreadItems(
        request.workspace.workspaceId,
        request.params.conversationId,
        request.query,
      ),
  );

  r.get(
    `${base}/conversations/:conversationId/messages/:messageId`,
    {
      preHandler: pre,
      schema: {
        params: z.object({ ...conversation, messageId: z.uuid() }),
        response: { 200: ThreadMessage },
      },
    },
    async (request) =>
      reads.getThreadMessage(
        request.workspace.workspaceId,
        request.params.conversationId,
        request.params.messageId,
      ),
  );

  r.get(
    `${base}/conversations/:conversationId/replies/:replyId`,
    {
      preHandler: pre,
      schema: {
        params: z.object({ ...conversation, replyId: z.uuid() }),
        response: { 200: ThreadReply },
      },
    },
    async (request) =>
      reads.getThreadReply(
        request.workspace.workspaceId,
        request.params.conversationId,
        request.params.replyId,
      ),
  );

  r.get(
    `${base}/conversations/:conversationId/activities/:activityId`,
    {
      preHandler: pre,
      schema: {
        params: z.object({ ...conversation, activityId: z.uuid() }),
        response: { 200: ThreadActivity },
      },
    },
    async (request) =>
      reads.getThreadActivity(
        request.workspace.workspaceId,
        request.params.conversationId,
        request.params.activityId,
      ),
  );

  // Any active member, either role: the assignee chooser (not the owner-only memberships list).
  r.get(
    `${base}/members`,
    {
      preHandler: pre,
      schema: { params: z.object(workspace), response: { 200: ActiveMemberList } },
    },
    async (request) => reads.listActiveMembers(request.workspace.workspaceId),
  );

  r.post(
    `${base}/conversations/:conversationId/read`,
    {
      preHandler: pre,
      schema: {
        params: z.object(conversation),
        body: ReadMarkRequest,
        response: { 200: ReadState },
      },
    },
    async (request) =>
      reads.markConversationRead(
        request.workspace.workspaceId,
        member(request),
        request.params.conversationId,
        new Date(request.body.read_through_at),
      ),
  );

  r.get(
    `${base}/bot`,
    { preHandler: pre, schema: { params: z.object(workspace), response: { 200: InboxBotStatus } } },
    async (request) => reads.getInboxBotStatus(request.workspace.workspaceId),
  );

  r.post(
    `${base}/conversations/:conversationId/replies`,
    {
      preHandler: pre,
      schema: {
        params: z.object(conversation),
        body: SendBody,
        response: { 200: ThreadReply, 201: ThreadReply },
      },
    },
    async (request, reply) => {
      const { created, reply: sent } = await replies.sendReply(
        request.workspace.workspaceId,
        request.account.id,
        request.params.conversationId,
        request.body,
      );
      return reply.status(created ? 201 : 200).send(sent);
    },
  );

  r.post(
    `${base}/conversations/:conversationId/replies/:replyId/resend`,
    {
      preHandler: pre,
      schema: {
        params: z.object({ ...conversation, replyId: z.uuid() }),
        body: ReplyResend,
        response: { 200: ThreadReply },
      },
    },
    async (request) =>
      replies.resendReply(
        request.workspace.workspaceId,
        request.account.id,
        request.params.conversationId,
        request.params.replyId,
        request.body,
      ),
  );

  r.get(
    `${base}/conversations/:conversationId/messages/:messageId/media`,
    {
      preHandler: pre,
      schema: {
        params: z.object({ ...conversation, messageId: z.uuid() }),
        headers: z.object({ range: RangeHeader.optional() }),
      },
    },
    async (request, reply) => {
      const opened = await media.openMessageMedia(
        request.workspace.workspaceId,
        request.params.conversationId,
        request.params.messageId,
        request.headers.range,
      );
      if (opened.outcome === 'range_not_satisfiable') return reply.status(416).send();
      // The download is dropped as soon as the client goes away (or the response ends).
      reply.raw.once('close', () => opened.body.destroy());
      reply
        .status(opened.status)
        .header('content-type', opened.contentType)
        .header('content-disposition', opened.contentDisposition)
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "sandbox; default-src 'none'")
        .header('cache-control', 'private, no-store');
      if (opened.contentLength !== null) reply.header('content-length', opened.contentLength);
      if (opened.status === 200) reply.header('accept-ranges', 'bytes');
      if (opened.contentRange) reply.header('content-range', opened.contentRange);
      return reply.send(opened.body);
    },
  );
}
