import {
  ContactPage,
  ContactProfile,
  ContactTagAdded,
  ContactTagRemoved,
  ConversationSummary,
  TagHistoryPage,
  type ContactTagAdd,
  type ContactTagRemove,
  type TagFilterMode,
} from '@tg/shared';
import { apiRequest } from '@/shared/api/client';

/** `background: true` marks automatic calls (live re-read): they must not extend the session. */
export interface ReadOptions {
  background?: boolean;
}

const workspace = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}`;
const contactPath = (workspaceId: string, contactId: string) =>
  `${workspace(workspaceId)}/contacts/${encodeURIComponent(contactId)}`;
const bg = (options: ReadOptions) => (options.background ? { background: true } : {});

/** `listContacts`: `mode` is written only when it is not `any`; `tag` repeats once per id. */
export const listContacts = (
  workspaceId: string,
  params: { q?: string; mode?: TagFilterMode; tag?: string[]; after?: string } = {},
  options: ReadOptions = {},
) => {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.mode && params.mode !== 'any') search.set('mode', params.mode);
  for (const id of params.tag ?? []) search.append('tag', id);
  if (params.after) search.set('after', params.after);
  const text = search.toString();
  return apiRequest(
    `${workspace(workspaceId)}/contacts${text ? `?${text}` : ''}`,
    ContactPage,
    bg(options),
  );
};

export const getContact = (workspaceId: string, contactId: string, options: ReadOptions = {}) =>
  apiRequest(contactPath(workspaceId, contactId), ContactProfile, bg(options));

export const listContactTagHistory = (
  workspaceId: string,
  contactId: string,
  params: { after?: string } = {},
  options: ReadOptions = {},
) =>
  apiRequest(
    `${contactPath(workspaceId, contactId)}/tag-history${params.after ? `?after=${encodeURIComponent(params.after)}` : ''}`,
    TagHistoryPage,
    bg(options),
  );

/** The contact's conversation summary (404 when it has none); the read never marks anything read. */
export const getContactConversation = (
  workspaceId: string,
  contactId: string,
  options: ReadOptions = {},
) =>
  apiRequest(
    `${workspace(workspaceId)}/inbox/contacts/${encodeURIComponent(contactId)}/conversation`,
    ConversationSummary,
    bg(options),
  );

export const addContactTag = (workspaceId: string, contactId: string, body: ContactTagAdd) =>
  apiRequest(`${contactPath(workspaceId, contactId)}/tags`, ContactTagAdded, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const removeContactTag = (
  workspaceId: string,
  contactId: string,
  tagId: string,
  body: ContactTagRemove,
) =>
  apiRequest(
    `${contactPath(workspaceId, contactId)}/tags/${encodeURIComponent(tagId)}/remove`,
    ContactTagRemoved,
    { method: 'POST', body: JSON.stringify(body) },
  );
