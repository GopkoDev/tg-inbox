import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  Conversation,
  ConversationPage,
  Cursor,
  InboxBotStatus,
  ReadMarkRequest,
  ReadState,
  ReplyResend,
  ReplySend,
  ThreadMessage,
  ThreadPage,
  ThreadReply,
} from '@tg/shared';
import { createWorkspaceGuard, type WorkspaceGuardDeps } from '../../workspaces/http/guard.js';
import type { InboxReadUseCases } from '../app/reads.js';
import type { SendReplyUseCases } from '../app/send-reply.js';

export interface InboxDeps {
  reads: InboxReadUseCases;
  replies: SendReplyUseCases;
  /** The workspaces guard dependency (membership check on every request). */
  access: WorkspaceGuardDeps;
  /** The auth module's session resolver (preHandler setting `request.account`). */
  authenticate: preHandlerAsyncHookHandler;
}

const Limit = z.coerce.number().int().min(1).max(100).default(50);
const workspace = { workspaceId: z.uuid() };
const conversation = { ...workspace, conversationId: z.uuid() };
// The text rules (blank, 4096 UTF-16 units) are answered by the use case with their own messages.
const SendBody = ReplySend.extend({ body: z.string() });

/**
 * The inbox routes under `/workspaces/:workspaceId/inbox` (openapi.yaml); the caller supplies the
 * `/api` prefix. Operators and owners have the same rights, so there is no role check.
 */
export async function registerInbox(app: FastifyInstance, deps: InboxDeps): Promise<void> {
  const { reads, replies, access, authenticate } = deps;
  const pre = [authenticate, createWorkspaceGuard(access)];
  const r = app.withTypeProvider<ZodTypeProvider>();
  const base = '/workspaces/:workspaceId/inbox';
  const member = (request: { account: { id: string }; workspace: { activeSince: Date } }) => ({
    accountId: request.account.id,
    activeSince: request.workspace.activeSince,
  });

  r.get(
    `${base}/conversations`,
    {
      preHandler: pre,
      schema: {
        params: z.object(workspace),
        querystring: z.object({
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
      schema: { params: z.object(conversation), response: { 200: Conversation } },
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
}
