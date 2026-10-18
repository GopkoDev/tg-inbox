import {
  Conversation,
  ConversationPage,
  InboxBotStatus,
  ReadState,
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
  params: { q?: string; after?: string; limit?: number } = {},
  options: ReadOptions = {},
) =>
  apiRequest(`${inbox(workspaceId)}/conversations${query(params)}`, ConversationPage, bg(options));

export const getConversation = (
  workspaceId: string,
  conversationId: string,
  options: ReadOptions = {},
) => apiRequest(conversationPath(workspaceId, conversationId), Conversation, bg(options));

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
