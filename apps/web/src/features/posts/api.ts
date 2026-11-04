import {
  DestinationCodeCreated,
  DestinationCodeStatus,
  DestinationList,
  DestinationRemoved,
  Outcome,
  Post,
  PostAttention,
  PostList,
  PostOutcome,
  PostScheduled,
  PublishConfirmation,
  TimeZoneSaved,
  type ExpectedVersion,
  type PostCreate,
  type PostSave,
  type PostSchedule,
  type TimeZoneSet,
} from '@tg/shared';
import { apiRequest } from '@/shared/api/client';

// One function per posts operation (contracts/openapi.yaml); every answer is parsed with its
// `@tg/shared` schema by `apiRequest`.

/** `background: true` marks automatic calls (live re-read): they must not extend the session. */
export interface ReadOptions {
  background?: boolean;
}

export type PostFilter = 'all' | 'drafts' | 'scheduled' | 'published' | 'attention';

const posts = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/posts`;
const postPath = (workspaceId: string, postId: string) =>
  `${posts(workspaceId)}/${encodeURIComponent(postId)}`;
const bg = (options: ReadOptions) => (options.background ? { background: true } : {});
const post = (body?: unknown) => ({
  method: 'POST',
  ...(body !== undefined && { body: JSON.stringify(body) }),
});

export const listDestinations = (workspaceId: string, options: ReadOptions = {}) =>
  apiRequest(`${posts(workspaceId)}/destinations`, DestinationList, bg(options));

export const createDestinationCode = (workspaceId: string) =>
  apiRequest(`${posts(workspaceId)}/destinations/connect-codes`, DestinationCodeCreated, post());

export const getDestinationCode = (workspaceId: string, codeId: string) =>
  apiRequest(
    `${posts(workspaceId)}/destinations/connect-codes/${encodeURIComponent(codeId)}`,
    DestinationCodeStatus,
    { background: true },
  );

export const removeDestination = (workspaceId: string, destinationId: string) =>
  apiRequest(
    `${posts(workspaceId)}/destinations/${encodeURIComponent(destinationId)}/remove`,
    DestinationRemoved,
    post(),
  );

export const setPostingTimeZone = (workspaceId: string, body: TimeZoneSet) =>
  apiRequest(`${posts(workspaceId)}/time-zone`, TimeZoneSaved, post(body));

export const listPosts = (
  workspaceId: string,
  filter: PostFilter = 'all',
  options: ReadOptions = {},
) =>
  apiRequest(
    `${posts(workspaceId)}${filter === 'all' ? '' : `?filter=${filter}`}`,
    PostList,
    bg(options),
  );

export const createPost = (workspaceId: string, body: PostCreate) =>
  apiRequest(posts(workspaceId), Post, post(body));

/** The count of posts needing attention (getPostAttention); always a background request. */
export const getPostAttention = (workspaceId: string) =>
  apiRequest(`${posts(workspaceId)}/attention`, PostAttention, { background: true });

export const getPost = (workspaceId: string, postId: string, options: ReadOptions = {}) =>
  apiRequest(postPath(workspaceId, postId), Post, bg(options));

export const savePost = (workspaceId: string, postId: string, body: PostSave) =>
  apiRequest(`${postPath(workspaceId, postId)}/save`, Post, post(body));

export const duplicatePost = (workspaceId: string, postId: string) =>
  apiRequest(`${postPath(workspaceId, postId)}/duplicate`, Post, post());

export const deletePostDraft = (workspaceId: string, postId: string) =>
  apiRequest(`${postPath(workspaceId, postId)}/delete`, Outcome, post());

export const getPublishConfirmation = (workspaceId: string, postId: string) =>
  apiRequest(`${postPath(workspaceId, postId)}/publish-confirmation`, PublishConfirmation);

export const publishPost = (workspaceId: string, postId: string, body: ExpectedVersion) =>
  apiRequest(`${postPath(workspaceId, postId)}/publish`, PostScheduled, post(body));

export const schedulePost = (workspaceId: string, postId: string, body: PostSchedule) =>
  apiRequest(`${postPath(workspaceId, postId)}/schedule`, PostScheduled, post(body));

export const movePostBackToDraft = (workspaceId: string, postId: string, body: ExpectedVersion) =>
  apiRequest(`${postPath(workspaceId, postId)}/back-to-draft`, PostOutcome, post(body));

export const deletePostFromTelegram = (workspaceId: string, postId: string) =>
  apiRequest(`${postPath(workspaceId, postId)}/delete-from-telegram`, PostOutcome, post());

export const markPostSeen = (workspaceId: string, postId: string) =>
  apiRequest(`${postPath(workspaceId, postId)}/seen`, Outcome, post());
