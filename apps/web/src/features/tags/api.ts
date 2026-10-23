import { TagDeleted, TagList, TagRenameResult, type TagDelete, type TagRename } from '@tg/shared';
import { apiRequest } from '@/shared/api/client';

/** `background: true` marks automatic calls (live re-read): they must not extend the session. */
export interface ReadOptions {
  background?: boolean;
}

const tags = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/tags`;

/** The workspace's tags with their contact counts, in dictionary order (listTags). */
export const listTags = (workspaceId: string, options: ReadOptions = {}) =>
  apiRequest(tags(workspaceId), TagList, options.background ? { background: true } : {});

/** An owner's rename; `merge_into_tag_id` confirms a merge into the tag that holds the name (renameTag). */
export const renameTag = (workspaceId: string, tagId: string, body: TagRename) =>
  apiRequest(`${tags(workspaceId)}/${encodeURIComponent(tagId)}/rename`, TagRenameResult, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** An owner's delete, against the contact count the owner confirmed (deleteTag). */
export const deleteTag = (workspaceId: string, tagId: string, body: TagDelete) =>
  apiRequest(`${tags(workspaceId)}/${encodeURIComponent(tagId)}/delete`, TagDeleted, {
    method: 'POST',
    body: JSON.stringify(body),
  });
