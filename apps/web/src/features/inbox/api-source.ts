import {
  ActiveMemberList,
  type AssignRequest,
  type AssigneeLens,
  type CloseRequest,
  ConversationPage,
  ConversationStateChange,
  ConversationSummary,
  InboxBotStatus,
  ReadState,
  type StateChangeRequest,
  type StatusLens,
  ThreadActivity,
  ThreadBroadcastItem,
  ThreadMessage,
  ThreadPage,
  ThreadReply,
} from '@tg/shared';
import { apiRequest } from '@/shared/api/client';

/** `background: true` marks automatic calls (live refetch, mark read): they must not extend the session. */
export interface ReadOptions {
  background?: boolean;
}

const inbox = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/inbox`;
const conversationPath = (workspaceId: string, conversationId: string) =>
  `${inbox(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`;
const bg = (options: ReadOptions) => (options.background ? { background: true } : {});

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const listConversations = (
  workspaceId: string,
  params: {
    q?: string;
    after?: string;
    limit?: number;
    status?: StatusLens;
    assignee?: AssigneeLens;
  } = {},
  options: ReadOptions = {},
) =>
  apiRequest(`${inbox(workspaceId)}/conversations${query(params)}`, ConversationPage, bg(options));

export const getConversation = (
  workspaceId: string,
  conversationId: string,
  options: ReadOptions = {},
) => apiRequest(conversationPath(workspaceId, conversationId), ConversationSummary, bg(options));

export const listThreadItems = (
  workspaceId: string,
  conversationId: string,
  params: { before?: string; after?: string; limit?: number } = {},
  options: ReadOptions = {},
) =>
  apiRequest(
    `${conversationPath(workspaceId, conversationId)}/items${query(params)}`,
    ThreadPage,
    bg(options),
  );

export const getThreadMessage = (
  workspaceId: string,
  conversationId: string,
  messageId: string,
  options: ReadOptions = {},
) =>
  apiRequest(
    `${conversationPath(workspaceId, conversationId)}/messages/${encodeURIComponent(messageId)}`,
    ThreadMessage,
    bg(options),
  );

export const getThreadReply = (
  workspaceId: string,
  conversationId: string,
  replyId: string,
  options: ReadOptions = {},
) =>
  apiRequest(
    `${conversationPath(workspaceId, conversationId)}/replies/${encodeURIComponent(replyId)}`,
    ThreadReply,
    bg(options),
  );

export const markConversationRead = (
  workspaceId: string,
  conversationId: string,
  readThroughAt: string,
  options: ReadOptions = {},
) =>
  apiRequest(`${conversationPath(workspaceId, conversationId)}/read`, ReadState, {
    method: 'POST',
    body: JSON.stringify({ read_through_at: readThroughAt }),
    ...bg(options),
  });

export const getInboxBotStatus = (workspaceId: string, options: ReadOptions = {}) =>
  apiRequest(`${inbox(workspaceId)}/bot`, InboxBotStatus, bg(options));

export interface SendReplyBody {
  client_key: string;
  body: string;
  last_seen_reply_id: string | null;
  confirm_teammate_reply?: boolean;
}

export const sendReply = (
  workspaceId: string,
  conversationId: string,
  body: SendReplyBody,
  options: ReadOptions = {},
) =>
  apiRequest(`${conversationPath(workspaceId, conversationId)}/replies`, ThreadReply, {
    method: 'POST',
    body: JSON.stringify(body),
    ...bg(options),
  });

export interface ResendReplyBody {
  confirm_duplicate_risk?: boolean;
}

export const resendReply = (
  workspaceId: string,
  conversationId: string,
  replyId: string,
  body: ResendReplyBody,
  options: ReadOptions = {},
) =>
  apiRequest(
    `${conversationPath(workspaceId, conversationId)}/replies/${encodeURIComponent(replyId)}/resend`,
    ThreadReply,
    { method: 'POST', body: JSON.stringify(body), ...bg(options) },
  );

export const getThreadActivity = (
  workspaceId: string,
  conversationId: string,
  activityId: string,
  options: ReadOptions = {},
) =>
  apiRequest(
    `${conversationPath(workspaceId, conversationId)}/activities/${encodeURIComponent(activityId)}`,
    ThreadActivity,
    bg(options),
  );

/** One broadcast item of the thread (ADR-0010); never marks anything read. */
export const getThreadBroadcastItem = (
  workspaceId: string,
  conversationId: string,
  broadcastItemId: string,
  options: ReadOptions = {},
) =>
  apiRequest(
    `${conversationPath(workspaceId, conversationId)}/broadcast-items/${encodeURIComponent(broadcastItemId)}`,
    ThreadBroadcastItem,
    bg(options),
  );

export const listActiveMembers = (workspaceId: string, options: ReadOptions = {}) =>
  apiRequest(`${inbox(workspaceId)}/members`, ActiveMemberList, bg(options));

const change = (
  workspaceId: string,
  conversationId: string,
  action: 'assign' | 'unassign' | 'close' | 'reopen',
  body: unknown,
  options: ReadOptions,
) =>
  apiRequest(
    `${conversationPath(workspaceId, conversationId)}/${action}`,
    ConversationStateChange,
    {
      method: 'POST',
      body: JSON.stringify(body),
      ...bg(options),
    },
  );

export const assignConversation = (
  workspaceId: string,
  conversationId: string,
  body: AssignRequest,
  options: ReadOptions = {},
) => change(workspaceId, conversationId, 'assign', body, options);

export const unassignConversation = (
  workspaceId: string,
  conversationId: string,
  body: StateChangeRequest,
  options: ReadOptions = {},
) => change(workspaceId, conversationId, 'unassign', body, options);

export const closeConversation = (
  workspaceId: string,
  conversationId: string,
  body: CloseRequest,
  options: ReadOptions = {},
) => change(workspaceId, conversationId, 'close', body, options);

export const reopenConversation = (
  workspaceId: string,
  conversationId: string,
  body: StateChangeRequest,
  options: ReadOptions = {},
) => change(workspaceId, conversationId, 'reopen', body, options);
