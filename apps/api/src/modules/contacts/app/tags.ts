import type { ContactTag, ContactTagAdded, ContactTagRemoved } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  ContactTagLimitReachedError,
  NotFoundError,
  TagChangeLimitReachedError,
  TagLimitReachedError,
  TagNameInvalidError,
  TagNotFoundError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { checkTagName } from '../domain/tag-name.js';
import {
  canAddToContact,
  canCreateTag,
  rateLimitDecision,
  TAG_CHANGE_WINDOW_MS,
} from '../domain/tags.js';
import { memberRefs } from './member-refs.js';
import type {
  ContactRepo,
  ContactTagRepo,
  ContactTagRow,
  DisplayNames,
  Executor,
  MemberTagSource,
  TagHistoryRepo,
  TagRecord,
  TagRepo,
  TagSignals,
} from './ports.js';

export interface TagWritesDeps {
  /** Runs `fn` in one database transaction; a throw rolls everything back. */
  transaction: <T>(fn: (tx: Executor) => Promise<T>) => Promise<T>;
  contacts: Pick<ContactRepo, 'lockContact'>;
  tags: Pick<TagRepo, 'lockWorkspaceTags' | 'findByKey' | 'count' | 'insert' | 'lockForKeyShare'>;
  contactTags: Pick<ContactTagRepo, 'tagsOf' | 'carries' | 'countFor' | 'insert' | 'delete'>;
  tagHistory: Pick<TagHistoryRepo, 'append' | 'memberChangesSince' | 'lockMemberChanges'>;
  signals: TagSignals;
  /** The `contacts → workspaces` edge: adders' names. */
  workspaces: DisplayNames;
  clock: Clock;
  /** Ids, kinds and outcome codes only; never tag names or contact names. */
  logger?: { info(obj: object, msg: string): void };
}

/** What a member picks (an id) or types (a name, tidied and matched by key). */
export type TagChoice = { tagId: string } | { name: string };

/** The member writes of a contact's tags (flows 9 and 10, ADR-0004). */
export interface TagWrites {
  addContactTag(
    workspaceId: string,
    actorAccountId: string,
    contactId: string,
    choice: TagChoice,
    source: MemberTagSource,
  ): Promise<ContactTagAdded>;
  removeContactTag(
    workspaceId: string,
    actorAccountId: string,
    contactId: string,
    tagId: string,
    source: MemberTagSource,
  ): Promise<ContactTagRemoved>;
}

export function createTagWrites(deps: TagWritesDeps): TagWrites {
  const { transaction, contacts, tags, contactTags, tagHistory, signals, workspaces, clock } = deps;

  const log = (outcome: string, ids: { workspaceId: string; contactId: string; tagId?: string }) =>
    deps.logger?.info({ ...ids, outcome }, 'contact tag change');

  /**
   * The contact's tags as the wire carries them, adders named. Called after the commit: the names
   * come through the pool, so resolving them inside the transaction would take a second connection
   * while the contact row and the locks are held (precedent: inbox/app/change-state.ts).
   */
  async function named(workspaceId: string, carried: ContactTagRow[]): Promise<ContactTag[]> {
    const ref = await memberRefs(
      workspaces,
      workspaceId,
      carried.map((t) => t.addedByAccountId),
    );
    return carried.map((t) => ({
      id: t.tagId,
      name: t.name,
      added_by: ref(t.addedByAccountId),
      added_at: t.addedAt.toISOString(),
    }));
  }

  /** Step 3 (member): the budget of recorded changes, refused with the time the oldest leaves. */
  async function checkBudget(workspaceId: string, accountId: string, now: Date, tx: Executor) {
    await tagHistory.lockMemberChanges(workspaceId, accountId, tx);
    const since = new Date(now.getTime() - TAG_CHANGE_WINDOW_MS);
    const { count, oldestAt } = await tagHistory.memberChangesSince(
      workspaceId,
      accountId,
      since,
      tx,
    );
    const decision = rateLimitDecision(count, oldestAt, now);
    if (!decision.allowed) {
      throw new TagChangeLimitReachedError(decision.retryAt, decision.retryAfterSeconds);
    }
  }

  return {
    async addContactTag(workspaceId, actorAccountId, contactId, choice, source) {
      const ids = { workspaceId, contactId };
      let name: { name: string; key: string } | null = null;
      if ('name' in choice) {
        const checked = checkTagName(choice.name);
        if (!checked.ok) {
          log('name_invalid', ids);
          throw new TagNameInvalidError();
        }
        name = { name: checked.name, key: checked.key };
      }

      // A refusal throws inside the transaction, so a tag created above it rolls back too.
      try {
        const { answer, carried } = await transaction(async (tx): Promise<AddAnswer> => {
          const now = clock.now();
          let tagId = 'tagId' in choice ? choice.tagId : '';
          let created = false;

          // 1. By name: find or create under the workspace tag lock (exact 100 limit, one tag per key).
          if (name !== null) {
            await tags.lockWorkspaceTags(workspaceId, tx);
            const existing = await tags.findByKey(workspaceId, name.key, tx);
            if (existing) {
              tagId = existing.id;
            } else {
              if (!canCreateTag(await tags.count(workspaceId, tx)))
                throw new TagLimitReachedError();
              tagId = newId();
              await tags.insert(
                workspaceId,
                {
                  id: tagId,
                  name: name.name,
                  key: name.key,
                  createdBy: actorAccountId,
                  createdAt: now,
                },
                tx,
              );
              created = true;
            }
          }

          // 2. The contact row (exact 20 limit, serialises this contact's writes).
          if (!(await contacts.lockContact(workspaceId, contactId, tx))) {
            throw new NotFoundError('Contact not found.');
          }

          // 3. The no-op and the 20-per-contact check.
          const carried = await contactTags.tagsOf(workspaceId, contactId, tx);
          const already = carried.find((t) => t.tagId === tagId);
          if (already) {
            log('unchanged', { ...ids, tagId });
            return {
              answer: {
                workspace_id: workspaceId,
                contact_id: contactId,
                outcome: 'unchanged',
                tag: { id: already.tagId, name: already.name },
                tag_created: false,
              },
              carried,
            };
          }
          if (!canAddToContact(carried.length)) throw new ContactTagLimitReachedError();

          // 4. The member's budget, just before the write.
          await checkBudget(workspaceId, actorAccountId, now, tx);

          // 5. The tag row FOR KEY SHARE: gone (deleted, merged away, foreign) = TAG_NOT_FOUND.
          const tag: TagRecord | null = await tags.lockForKeyShare(workspaceId, tagId, tx);
          if (!tag) throw new TagNotFoundError(tagId);

          // An owner merge we waited for at step 5 may have re-pointed one of this contact's links
          // to this very tag: then it already carries it (and has the merged entry), so unchanged.
          if (await contactTags.carries(workspaceId, contactId, tagId, tx)) {
            log('unchanged', { ...ids, tagId });
            return {
              answer: {
                workspace_id: workspaceId,
                contact_id: contactId,
                outcome: 'unchanged',
                tag: { id: tag.id, name: tag.name },
                tag_created: false,
              },
              carried: await contactTags.tagsOf(workspaceId, contactId, tx),
            };
          }

          // 6-8. The link, one added entry carrying the current name, the signals.
          await contactTags.insert(
            { workspaceId, contactId, tagId, addedByAccountId: actorAccountId, addedAt: now },
            tx,
          );
          await tagHistory.append(
            {
              workspaceId,
              contactId,
              tagId,
              tagName: tag.name,
              kind: 'added',
              actorAccountId,
              source,
              createdAt: now,
            },
            tx,
          );
          await signals.contactChanged(tx, workspaceId, contactId);
          if (created) await signals.tagsChanged(tx, workspaceId);
          log('added', { ...ids, tagId });
          return {
            answer: {
              workspace_id: workspaceId,
              contact_id: contactId,
              outcome: 'recorded',
              tag: { id: tag.id, name: tag.name },
              tag_created: created,
            },
            carried: await contactTags.tagsOf(workspaceId, contactId, tx),
          };
        });
        return { ...answer, tags: await named(workspaceId, carried) };
      } catch (e) {
        const code = (e as { code?: string }).code;
        const outcome = REFUSALS[code ?? ''];
        if (outcome) log(outcome, ids);
        throw e;
      }
    },

    async removeContactTag(workspaceId, actorAccountId, contactId, tagId, source) {
      const ids = { workspaceId, contactId, tagId };
      try {
        const { answer, carried } = await transaction(async (tx): Promise<RemoveAnswer> => {
          const now = clock.now();
          // 2. The contact row; a removal touches no tag row, so it never waits on an owner.
          if (!(await contacts.lockContact(workspaceId, contactId, tx))) {
            throw new NotFoundError('Contact not found.');
          }
          // 3. Not carried (deleted, merged, foreign or never carried) = unchanged, no hint which.
          const carried = await contactTags.tagsOf(workspaceId, contactId, tx);
          const row = carried.find((t) => t.tagId === tagId);
          const unchanged = (rows: ContactTagRow[]): RemoveAnswer => {
            log('unchanged', ids);
            return {
              answer: { workspace_id: workspaceId, contact_id: contactId, outcome: 'unchanged' },
              carried: rows,
            };
          };
          if (!row) return unchanged(carried);
          // 4. The budget, shared with adds.
          await checkBudget(workspaceId, actorAccountId, now, tx);
          // 5-7. The link, one removed entry with the current name, the signal. An owner merge or
          // delete that held the link row took it first: nothing removed, so nothing recorded.
          if (!(await contactTags.delete(workspaceId, contactId, tagId, tx))) {
            return unchanged(await contactTags.tagsOf(workspaceId, contactId, tx));
          }
          await tagHistory.append(
            {
              workspaceId,
              contactId,
              tagId,
              tagName: row.name,
              kind: 'removed',
              actorAccountId,
              source,
              createdAt: now,
            },
            tx,
          );
          await signals.contactChanged(tx, workspaceId, contactId);
          log('removed', ids);
          return {
            answer: { workspace_id: workspaceId, contact_id: contactId, outcome: 'recorded' },
            carried: await contactTags.tagsOf(workspaceId, contactId, tx),
          };
        });
        return { ...answer, tags: await named(workspaceId, carried) };
      } catch (e) {
        const outcome = REFUSALS[(e as { code?: string }).code ?? ''];
        if (outcome) log(outcome, ids);
        throw e;
      }
    },
  };
}

/** A use case's answer before the adders are named, and the carried rows to name after the commit. */
type AddAnswer = { answer: Omit<ContactTagAdded, 'tags'>; carried: ContactTagRow[] };
type RemoveBody = Omit<ContactTagRemoved, 'tags'>;
type RemoveAnswer = { answer: RemoveBody; carried: ContactTagRow[] };

/** Error code to the structured-log outcome of a refused change. */
const REFUSALS: Record<string, string> = {
  TAG_LIMIT_REACHED: 'workspace_limit',
  CONTACT_TAG_LIMIT_REACHED: 'contact_limit',
  TAG_NOT_FOUND: 'tag_gone',
  TAG_CHANGE_LIMIT_REACHED: 'rate_limited',
  NOT_FOUND: 'contact_not_found',
};
