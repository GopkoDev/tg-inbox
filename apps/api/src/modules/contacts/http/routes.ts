import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContactPage,
  ContactProfile,
  ContactTagAdd,
  ContactTagAdded,
  ContactTagRemove,
  ContactTagRemoved,
  Cursor,
  ListContactsQuery,
  TagDelete,
  TagDeleted,
  TagHistoryPage,
  TagList,
  TagRename,
  TagRenameResult,
} from '@tg/shared';
import {
  createWorkspaceGuard,
  ownerOnly,
  type WorkspaceGuardDeps,
} from '../../workspaces/http/guard.js';
import type { ContactReads } from '../app/contacts.js';
import type { TagAdmin } from '../app/tag-admin.js';
import type { TagWrites } from '../app/tags.js';

export interface ContactsDeps {
  reads: ContactReads;
  /** A member's add / remove of a contact's tags. */
  writes: TagWrites;
  /** The owner's list, rename / merge and delete. */
  admin: TagAdmin;
  /** The workspaces guard dependency (membership check on every request). */
  access: WorkspaceGuardDeps;
  /** The auth module's session resolver (preHandler setting `request.account`). */
  authenticate: preHandlerAsyncHookHandler;
}

const OWNER_ONLY_TAGS = "Only a business owner manages the workspace's tags";
// The schemas keep `workspaceId`: the guard reads it from the params, and a malformed one is its 404.
const workspace = { workspaceId: z.string() };
const contact = { ...workspace, contactId: z.uuid() };
const tag = { ...workspace, tagId: z.uuid() };

/**
 * The contacts routes under `/workspaces/:workspaceId` (openapi.yaml); the caller supplies the
 * `/api` prefix. Both roles read contacts and tags and change a contact's tags; rename, merge and
 * delete are owner-only. A malformed workspace id is the guard's 404, so it is not validated here.
 */
export async function registerContacts(app: FastifyInstance, deps: ContactsDeps): Promise<void> {
  const { reads, writes, admin, access, authenticate } = deps;
  const member = [authenticate, createWorkspaceGuard(access)];
  const owner = [...member, ownerOnly(OWNER_ONLY_TAGS)];
  const r = app.withTypeProvider<ZodTypeProvider>();
  const base = '/workspaces/:workspaceId';

  r.get(
    `${base}/contacts`,
    {
      preHandler: member,
      schema: { querystring: ListContactsQuery, response: { 200: ContactPage } },
    },
    async (request) =>
      reads.listContacts(request.workspace.workspaceId, {
        q: request.query.q,
        mode: request.query.mode,
        tagIds: request.query.tag,
        after: request.query.after,
      }),
  );

  r.get(
    `${base}/contacts/:contactId`,
    {
      preHandler: member,
      schema: { params: z.object(contact), response: { 200: ContactProfile } },
    },
    async (request) => reads.getContact(request.workspace.workspaceId, request.params.contactId),
  );

  r.get(
    `${base}/contacts/:contactId/tag-history`,
    {
      preHandler: member,
      schema: {
        params: z.object(contact),
        querystring: z.strictObject({ after: Cursor.optional() }),
        response: { 200: TagHistoryPage },
      },
    },
    async (request) =>
      reads.listTagHistory(
        request.workspace.workspaceId,
        request.params.contactId,
        request.query.after,
      ),
  );

  r.post(
    `${base}/contacts/:contactId/tags`,
    {
      preHandler: member,
      schema: {
        params: z.object(contact),
        body: ContactTagAdd,
        response: { 200: ContactTagAdded },
      },
    },
    async (request) => {
      const { body } = request;
      return writes.addContactTag(
        request.workspace.workspaceId,
        request.account.id,
        request.params.contactId,
        'tag_id' in body ? { tagId: body.tag_id } : { name: body.name },
        body.source,
      );
    },
  );

  r.post(
    `${base}/contacts/:contactId/tags/:tagId/remove`,
    {
      preHandler: member,
      schema: {
        params: z.object({ ...contact, ...tag }),
        body: ContactTagRemove,
        response: { 200: ContactTagRemoved },
      },
    },
    async (request) =>
      writes.removeContactTag(
        request.workspace.workspaceId,
        request.account.id,
        request.params.contactId,
        request.params.tagId,
        request.body.source,
      ),
  );

  r.get(
    `${base}/tags`,
    { preHandler: member, schema: { response: { 200: TagList } } },
    async (request) => admin.listTags(request.workspace.workspaceId),
  );

  r.post(
    `${base}/tags/:tagId/rename`,
    {
      preHandler: owner,
      schema: {
        params: z.object(tag),
        body: TagRename,
        response: { 200: TagRenameResult },
      },
    },
    async (request) =>
      admin.renameTag(request.workspace.workspaceId, request.account.id, request.params.tagId, {
        name: request.body.name,
        mergeIntoTagId: request.body.merge_into_tag_id,
      }),
  );

  r.post(
    `${base}/tags/:tagId/delete`,
    {
      preHandler: owner,
      schema: {
        params: z.object(tag),
        body: TagDelete,
        response: { 200: TagDeleted },
      },
    },
    async (request) =>
      admin.deleteTag(
        request.workspace.workspaceId,
        request.account.id,
        request.params.tagId,
        request.body.expected_count,
      ),
  );
}
