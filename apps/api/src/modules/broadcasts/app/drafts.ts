import {
  broadcastTextLength,
  checkBroadcastName,
  checkBroadcastText,
  tidyBroadcastText,
  type BroadcastAudienceSave,
  type BroadcastCreate,
  type BroadcastDeleted,
  type BroadcastDraft,
  type BroadcastFieldsSave,
} from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  AccessRemovedError,
  BroadcastDraftChangedError,
  BroadcastGroupChangedError,
  BroadcastNameInvalidError,
  BroadcastNotADraftError,
  BroadcastTextInvalidError,
  ForbiddenError,
  NotFoundError,
  TagNotFoundError,
  ValidationError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { checkTagAudience } from '../domain/audience.js';
import { canDelete, isEditable, isStaleVersion, type MemberRole } from '../domain/broadcast.js';
import type {
  AudienceTagRepo,
  AudienceTagRow,
  BroadcastRecord,
  BroadcastRepo,
  BroadcastSignals,
  ContactsApi,
  DraftView,
  Executor,
  GroupRepo,
  Transaction,
  WorkspacesApi,
} from './ports.js';

export interface DraftsDeps {
  transaction: Transaction;
  broadcasts: BroadcastRepo;
  audienceTags: Pick<AudienceTagRepo, 'replace'>;
  groups: Pick<GroupRepo, 'count' | 'removeAll'>;
  contacts: Pick<ContactsApi, 'resolveTags'>;
  workspaces: Pick<WorkspacesApi, 'lockActiveMembers'>;
  signals: BroadcastSignals;
  views: DraftView;
  clock: Clock;
}

export interface DraftActor {
  accountId: string;
  role: MemberRole;
}

/** Drafts (sad.md §6 flows 6, 7 and 9): any active member creates and edits; nothing needs a bot. */
export interface Drafts {
  createDraft(
    workspaceId: string,
    actorAccountId: string,
    input: BroadcastCreate,
  ): Promise<BroadcastDraft>;
  /** Name and / or text against the version shown (AC-02, AC-03, AC-09). */
  saveFields(
    workspaceId: string,
    actorAccountId: string,
    broadcastId: string,
    input: BroadcastFieldsSave,
  ): Promise<BroadcastDraft>;
  /** A tag audience, or a switch of the kind, against the version shown (AC-01, AC-03, AC-05). */
  saveAudience(
    workspaceId: string,
    actorAccountId: string,
    broadcastId: string,
    input: BroadcastAudienceSave,
  ): Promise<BroadcastDraft>;
  /** By its author or an active business owner (AC-07). */
  deleteDraft(
    workspaceId: string,
    actor: DraftActor,
    broadcastId: string,
  ): Promise<BroadcastDeleted>;
}

const NOT_FOUND = 'Broadcast not found.';

function validName(raw: string): string {
  const name = checkBroadcastName(raw);
  if (!name.ok) throw new BroadcastNameInvalidError();
  return name.name;
}

function validText(raw: string): string {
  const text = checkBroadcastText(raw);
  if (!text.ok) throw new BroadcastTextInvalidError(broadcastTextLength(tidyBroadcastText(raw)));
  return text.text;
}

/** A refusal decided under the row lock, thrown after the transaction (the view reads committed state). */
type Outcome = { kind: 'written' | 'unchanged' } | { kind: 'stale' };

export function createDrafts(deps: DraftsDeps): Drafts {
  const { transaction, broadcasts, audienceTags, groups, contacts, workspaces, signals } = deps;
  const { views, clock } = deps;

  /** The broadcast row `FOR NO KEY UPDATE` (§8), refused when foreign or launched. */
  async function lockDraft(
    tx: Executor,
    workspaceId: string,
    id: string,
  ): Promise<BroadcastRecord> {
    const row = await broadcasts.lockForUpdate(workspaceId, id, tx);
    if (row === null) throw new NotFoundError(NOT_FOUND);
    if (!isEditable(row.status)) {
      throw new BroadcastNotADraftError(id, row.status as 'sending' | 'sent' | 'stopped');
    }
    return row;
  }

  /** Runs a versioned write; a stale version answers the current draft (AC-03). */
  async function versioned(
    workspaceId: string,
    id: string,
    write: (tx: Executor, row: BroadcastRecord) => Promise<Outcome>,
    expectedVersion: number,
  ): Promise<BroadcastDraft> {
    const outcome = await transaction(async (tx): Promise<Outcome> => {
      const row = await lockDraft(tx, workspaceId, id);
      if (isStaleVersion({ expected: expectedVersion, current: row.version })) {
        return { kind: 'stale' };
      }
      const result = await write(tx, row);
      if (result.kind === 'written') await signals.broadcastChanged(tx, workspaceId, id, 'draft');
      return result;
    });
    const draft = await views.draftView(workspaceId, id);
    if (outcome.kind === 'stale') throw new BroadcastDraftChangedError(draft);
    return draft;
  }

  return {
    async createDraft(workspaceId, actorAccountId, input) {
      const name = validName(input.name);
      const text = input.text === undefined ? '' : validText(input.text);
      const id = newId();
      await transaction(async (tx) => {
        await broadcasts.insertDraft(
          workspaceId,
          {
            id,
            name,
            text,
            audienceKind: 'tags',
            tagMode: 'any',
            authorAccountId: actorAccountId,
            createdAt: clock.now(),
          },
          tx,
        );
        await signals.broadcastChanged(tx, workspaceId, id, 'draft');
      });
      return views.draftView(workspaceId, id);
    },

    async saveFields(workspaceId, actorAccountId, broadcastId, input) {
      const fields = {
        ...(input.name !== undefined && { name: validName(input.name) }),
        ...(input.text !== undefined && { text: validText(input.text) }),
      };
      return versioned(
        workspaceId,
        broadcastId,
        async (tx) => {
          await broadcasts.saveFields(
            workspaceId,
            broadcastId,
            input.expected_version,
            fields,
            actorAccountId,
            clock.now(),
            tx,
          );
          return { kind: 'written' };
        },
        input.expected_version,
      );
    },

    async saveAudience(workspaceId, actorAccountId, broadcastId, input) {
      const save = (tx: Executor, fields: Parameters<BroadcastRepo['saveFields']>[3]) =>
        broadcasts.saveFields(
          workspaceId,
          broadcastId,
          input.expected_version,
          fields,
          actorAccountId,
          clock.now(),
          tx,
        );

      if (input.kind === 'group') {
        return versioned(
          workspaceId,
          broadcastId,
          async (tx, row) => {
            if (row.audienceKind === 'group') return { kind: 'unchanged' };
            await audienceTags.replace(workspaceId, broadcastId, [], tx);
            await save(tx, { audienceKind: 'group', tagMode: null });
            return { kind: 'written' };
          },
          input.expected_version,
        );
      }

      const shape = checkTagAudience({
        mode: input.mode,
        include: input.tag_ids,
        exclude: input.exclude_tag_ids,
      });
      if (!shape.ok) {
        throw new ValidationError('The tag audience is not valid.', { field: shape.field });
      }
      // Every id resolved among the workspace's own tags, with its name now (ADR-0004).
      const ids = [...input.tag_ids, ...input.exclude_tag_ids];
      const names = new Map(
        (await contacts.resolveTags(workspaceId, ids)).map((t) => [t.id, t.name]),
      );
      const missing = ids.find((id) => !names.has(id));
      if (missing !== undefined) throw new TagNotFoundError(missing);
      const rows: AudienceTagRow[] = [
        ...input.tag_ids.map((id) => ({
          tagId: id,
          name: names.get(id)!,
          kind: 'include' as const,
        })),
        ...input.exclude_tag_ids.map((id) => ({
          tagId: id,
          name: names.get(id)!,
          kind: 'exclude' as const,
        })),
      ];

      return versioned(
        workspaceId,
        broadcastId,
        async (tx, row) => {
          if (row.audienceKind === 'group') {
            // Switching away from a group needs the size the member confirmed (AC-03, SCR-32).
            const size = await groups.count(workspaceId, broadcastId, tx);
            if (size > 0 && (input.expected_group_size ?? 0) !== size) {
              throw new BroadcastGroupChangedError(size);
            }
            await groups.removeAll(workspaceId, broadcastId, tx);
          }
          await audienceTags.replace(workspaceId, broadcastId, rows, tx);
          await save(tx, { audienceKind: 'tags', tagMode: input.mode });
          return { kind: 'written' };
        },
        input.expected_version,
      );
    },

    async deleteDraft(workspaceId, actor, broadcastId) {
      await transaction(async (tx) => {
        // Lock order (sad.md §8): the membership FOR SHARE, then the broadcast row.
        const active = await workspaces.lockActiveMembers(tx, workspaceId, [actor.accountId]);
        if (!active.includes(actor.accountId)) {
          throw new AccessRemovedError('Your access to this workspace was removed');
        }
        const row = await lockDraft(tx, workspaceId, broadcastId);
        const allowed = canDelete({
          role: actor.role,
          accountId: actor.accountId,
          authorId: row.authorAccountId,
        });
        if (!allowed) {
          throw new ForbiddenError('A draft is deleted by its author or a business owner.');
        }
        await broadcasts.deleteDraft(workspaceId, broadcastId, tx);
        await signals.broadcastChanged(tx, workspaceId, broadcastId, 'deleted');
      });
      return { workspace_id: workspaceId, broadcast_id: broadcastId };
    },
  };
}
