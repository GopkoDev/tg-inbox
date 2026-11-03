import {
  Broadcast,
  BroadcastDeleted,
  BroadcastDraft,
  BroadcastGroupChange,
  BroadcastGroupMatching,
  BroadcastGroupMatchingAdded,
  BroadcastGroupMembership,
  BroadcastGroupPage,
  BroadcastLaunched,
  BroadcastList,
  BroadcastRecipientPage,
  BroadcastStopped,
  LaunchConfirmation,
  type BroadcastAudienceSave,
  type BroadcastCreate,
  type BroadcastDuplicate,
  type BroadcastFieldsSave,
  type BroadcastGroupAdd,
  type BroadcastGroupAddMatching,
  type BroadcastLaunch,
  type RecipientState,
  type TagFilterMode,
} from '@tg/shared';
import { apiRequest } from '@/shared/api/client';

// One function per broadcasts operation (contracts/openapi.yaml); every answer is parsed with its
// `@tg/shared` schema by `apiRequest`.

/** `background: true` marks automatic calls (live re-read): they must not extend the session. */
export interface ReadOptions {
  background?: boolean;
}

const workspace = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}`;
const broadcastPath = (workspaceId: string, broadcastId: string) =>
  `${workspace(workspaceId)}/broadcasts/${encodeURIComponent(broadcastId)}`;
const bg = (options: ReadOptions) => (options.background ? { background: true } : {});
const post = (body?: unknown) => ({
  method: 'POST',
  ...(body !== undefined && { body: JSON.stringify(body) }),
});
const query = (params: URLSearchParams) => {
  const text = params.toString();
  return text ? `?${text}` : '';
};

export const listBroadcasts = (workspaceId: string, options: ReadOptions = {}) =>
  apiRequest(`${workspace(workspaceId)}/broadcasts`, BroadcastList, bg(options));

export const createBroadcast = (workspaceId: string, body: BroadcastCreate) =>
  apiRequest(`${workspace(workspaceId)}/broadcasts`, BroadcastDraft, post(body));

export const getBroadcast = (workspaceId: string, broadcastId: string, options: ReadOptions = {}) =>
  apiRequest(broadcastPath(workspaceId, broadcastId), Broadcast, bg(options));

export const saveBroadcastFields = (
  workspaceId: string,
  broadcastId: string,
  body: BroadcastFieldsSave,
) => apiRequest(`${broadcastPath(workspaceId, broadcastId)}/save`, BroadcastDraft, post(body));

export const saveBroadcastAudience = (
  workspaceId: string,
  broadcastId: string,
  body: BroadcastAudienceSave,
) => apiRequest(`${broadcastPath(workspaceId, broadcastId)}/audience`, BroadcastDraft, post(body));

export const listBroadcastGroup = (
  workspaceId: string,
  broadcastId: string,
  params: { after?: string } = {},
  options: ReadOptions = {},
) => {
  const search = new URLSearchParams();
  if (params.after) search.set('after', params.after);
  return apiRequest(
    `${broadcastPath(workspaceId, broadcastId)}/group${query(search)}`,
    BroadcastGroupPage,
    bg(options),
  );
};

/** Which of up to 50 contacts (a picker page) are in the group. */
export const getBroadcastGroupMembership = (
  workspaceId: string,
  broadcastId: string,
  contactIds: readonly string[],
  options: ReadOptions = {},
) => {
  const search = new URLSearchParams();
  for (const id of contactIds) search.append('contact', id);
  return apiRequest(
    `${broadcastPath(workspaceId, broadcastId)}/group/membership${query(search)}`,
    BroadcastGroupMembership,
    bg(options),
  );
};

export const addBroadcastGroupContact = (
  workspaceId: string,
  broadcastId: string,
  body: BroadcastGroupAdd,
) =>
  apiRequest(
    `${broadcastPath(workspaceId, broadcastId)}/group/contacts`,
    BroadcastGroupChange,
    post(body),
  );

export const removeBroadcastGroupContact = (
  workspaceId: string,
  broadcastId: string,
  contactId: string,
) =>
  apiRequest(
    `${broadcastPath(workspaceId, broadcastId)}/group/contacts/${encodeURIComponent(contactId)}/remove`,
    BroadcastGroupChange,
    post(),
  );

/** The picker's filter as the Contacts list takes it: `mode` only when not `any`, `tag` repeated. */
export const countBroadcastGroupMatching = (
  workspaceId: string,
  broadcastId: string,
  params: { q?: string; mode?: TagFilterMode; tag?: string[] } = {},
) => {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.mode && params.mode !== 'any') search.set('mode', params.mode);
  for (const id of params.tag ?? []) search.append('tag', id);
  return apiRequest(
    `${broadcastPath(workspaceId, broadcastId)}/group/matching${query(search)}`,
    BroadcastGroupMatching,
  );
};

export const addBroadcastGroupMatching = (
  workspaceId: string,
  broadcastId: string,
  body: BroadcastGroupAddMatching,
) =>
  apiRequest(
    `${broadcastPath(workspaceId, broadcastId)}/group/add-matching`,
    BroadcastGroupMatchingAdded,
    post(body),
  );

export const deleteBroadcast = (workspaceId: string, broadcastId: string) =>
  apiRequest(`${broadcastPath(workspaceId, broadcastId)}/delete`, BroadcastDeleted, post());

export const duplicateBroadcast = (
  workspaceId: string,
  broadcastId: string,
  body: BroadcastDuplicate,
) => apiRequest(`${broadcastPath(workspaceId, broadcastId)}/duplicate`, BroadcastDraft, post(body));

export const getLaunchConfirmation = (workspaceId: string, broadcastId: string) =>
  apiRequest(`${broadcastPath(workspaceId, broadcastId)}/launch-confirmation`, LaunchConfirmation);

export const launchBroadcast = (workspaceId: string, broadcastId: string, body: BroadcastLaunch) =>
  apiRequest(`${broadcastPath(workspaceId, broadcastId)}/launch`, BroadcastLaunched, post(body));

export const stopBroadcast = (workspaceId: string, broadcastId: string) =>
  apiRequest(`${broadcastPath(workspaceId, broadcastId)}/stop`, BroadcastStopped, post());

export const listBroadcastRecipients = (
  workspaceId: string,
  broadcastId: string,
  params: { state?: RecipientState; after?: string } = {},
  options: ReadOptions = {},
) => {
  const search = new URLSearchParams();
  if (params.state) search.set('state', params.state);
  if (params.after) search.set('after', params.after);
  return apiRequest(
    `${broadcastPath(workspaceId, broadcastId)}/recipients${query(search)}`,
    BroadcastRecipientPage,
    bg(options),
  );
};
