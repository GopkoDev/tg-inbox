import type {
  AudienceTag,
  Broadcast,
  BroadcastDraft,
  BroadcastList,
  BroadcastListItem,
  BroadcastRecipientPage,
  LaunchedBroadcast,
  MemberRef,
} from '@tg/shared';
import { NotFoundError, ValidationError } from '../../../platform/errors.js';
import { splitExistingTags } from '../domain/audience.js';
import { decodeRecipientCursor, encodeRecipientCursor } from '../domain/cursor.js';
import type { RecipientState } from '../domain/recipient.js';
import type {
  AudienceSpec,
  AudienceTagRepo,
  AudienceTagRow,
  BotsApi,
  BroadcastRecord,
  BroadcastRepo,
  ContactsApi,
  DraftView,
  GroupRepo,
  RecipientRepo,
  WorkspacesApi,
} from './ports.js';

export interface BroadcastReadsDeps {
  broadcasts: Pick<BroadcastRepo, 'find' | 'list'>;
  audienceTags: Pick<AudienceTagRepo, 'list'>;
  groups: Pick<GroupRepo, 'count' | 'ids'>;
  recipients: Pick<RecipientRepo, 'totals' | 'page' | 'notReachedCount'>;
  contacts: Pick<ContactsApi, 'resolveTags' | 'audienceBreakdown' | 'contactCards'>;
  bots: BotsApi;
  workspaces: Pick<WorkspacesApi, 'displayNames'>;
}

/** What the inbox thread shows of a broadcast item's broadcast (AC-16). */
export interface BroadcastItemDetails {
  broadcast_id: string;
  broadcast_name: string;
  text: string;
  launched_by: MemberRef;
}

/** Every read a member sees a broadcast through (sad.md §6 flows 5, 7, 11, 18). */
export interface BroadcastReads extends DraftView {
  /** Drafts and launched broadcasts together, most recently changed first (AC-01). */
  listBroadcasts(workspaceId: string): Promise<BroadcastList>;
  /** A draft with its breakdown for the current bot, or a launched broadcast as frozen (AC-01, AC-11). */
  getBroadcast(workspaceId: string, broadcastId: string): Promise<Broadcast>;
  /** 50 recipients by position, optionally of one outcome; a draft answers an empty page (AC-11). */
  listRecipients(
    workspaceId: string,
    broadcastId: string,
    q: { state?: RecipientState; after?: string },
  ): Promise<BroadcastRecipientPage>;
  /** The launched broadcasts among `broadcastIds`, in first-seen order; others are left out (AC-16). */
  itemDetails(
    workspaceId: string,
    broadcastIds: readonly string[],
  ): Promise<BroadcastItemDetails[]>;
}

export const RECIPIENT_PAGE_SIZE = 50;
const NOT_FOUND = 'Broadcast not found.';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d === null ? null : d.toISOString());
const wireTag = (t: AudienceTagRow): AudienceTag => ({
  tag_id: t.tagId,
  name: t.name,
  kind: t.kind,
});
/** Chosen tags before left-out ones, each in the stored order. */
const wireTags = (rows: readonly AudienceTagRow[]): AudienceTag[] =>
  [...rows.filter((t) => t.kind === 'include'), ...rows.filter((t) => t.kind === 'exclude')].map(
    wireTag,
  );

export function createBroadcastReads(deps: BroadcastReadsDeps): BroadcastReads {
  const { broadcasts, audienceTags, groups, recipients, contacts, bots, workspaces } = deps;

  /** Names of the accounts, deactivated members included; '?' only guards a removed account. */
  async function refs(workspaceId: string, accountIds: readonly (string | null)[]) {
    const unique = [...new Set(accountIds.filter((a): a is string => a !== null))];
    const names = unique.length
      ? await workspaces.displayNames(workspaceId, unique)
      : new Map<string, string>();
    return (accountId: string): MemberRef => ({
      account_id: accountId,
      display_name: names.get(accountId) ?? '?',
    });
  }

  async function found(workspaceId: string, id: string): Promise<BroadcastRecord> {
    const row = await broadcasts.find(workspaceId, id);
    if (row === null) throw new NotFoundError(NOT_FOUND);
    return row;
  }

  /**
   * A tag audience as it is now: stored tags that still exist under their current names, those
   * deleted or merged away dropped by their stored name (AC-01).
   */
  async function currentTags(workspaceId: string, broadcastId: string) {
    const stored = await audienceTags.list(workspaceId, broadcastId);
    const names = new Map(
      (
        await contacts.resolveTags(
          workspaceId,
          stored.map((t) => t.tagId),
        )
      ).map((t) => [t.id, t.name]),
    );
    const { kept, dropped } = splitExistingTags(stored, new Set(names.keys()));
    return {
      kept: kept.map((t) => ({ ...t, name: names.get(t.tagId)! })),
      dropped,
    };
  }

  const tagSpec = (row: BroadcastRecord, kept: readonly AudienceTagRow[]): AudienceSpec => ({
    kind: 'tags',
    mode: row.tagMode!,
    include: kept.filter((t) => t.kind === 'include').map((t) => t.tagId),
    exclude: kept.filter((t) => t.kind === 'exclude').map((t) => t.tagId),
  });

  async function draftOf(row: BroadcastRecord): Promise<BroadcastDraft> {
    const { workspaceId, id } = row;
    // Every draft read is computed now for the current Telegram bot (sad.md §11 accepted debt).
    const bot = await bots.launchReadiness(workspaceId);
    const botId = bot?.telegramBotId ?? null;
    let audience: BroadcastDraft['audience'];
    let spec: AudienceSpec;
    if (row.audienceKind === 'group') {
      const ids = await groups.ids(workspaceId, id);
      audience = { kind: 'group', size: ids.length };
      spec = { kind: 'ids', contactIds: ids };
    } else {
      const { kept, dropped } = await currentTags(workspaceId, id);
      audience = {
        kind: 'tags',
        mode: row.tagMode!,
        tags: wireTags(kept),
        dropped_tags: wireTags(dropped),
      };
      spec = tagSpec(row, kept);
    }
    const [breakdown, ref] = await Promise.all([
      contacts.audienceBreakdown(workspaceId, spec, botId),
      refs(workspaceId, [row.authorAccountId, row.lastChangedByAccountId]),
    ]);
    return {
      id,
      workspace_id: workspaceId,
      name: row.name,
      author: ref(row.authorAccountId),
      last_changed_by: ref(row.lastChangedByAccountId),
      last_changed_at: iso(row.lastChangedAt),
      created_at: iso(row.createdAt),
      status: 'draft',
      version: row.version,
      text: row.text,
      audience,
      breakdown: {
        audience_size: breakdown.audienceSize,
        reach: breakdown.reach && {
          blocked_count: breakdown.reach.blocked,
          never_wrote_count: breakdown.reach.neverWrote,
          reachable_count: breakdown.reach.reachable,
        },
      },
    };
  }

  /** The audience as defined at launch and the breakdown frozen then; only the totals are live. */
  async function launchedOf(row: BroadcastRecord): Promise<LaunchedBroadcast> {
    const { workspaceId, id } = row;
    const [stored, totals, notReached, ref] = await Promise.all([
      row.audienceKind === 'tags' ? audienceTags.list(workspaceId, id) : Promise.resolve([]),
      recipients.totals(workspaceId, id),
      recipients.notReachedCount(workspaceId, id),
      refs(workspaceId, [
        row.authorAccountId,
        row.lastChangedByAccountId,
        row.launchedByAccountId,
        row.stoppedByAccountId,
      ]),
    ]);
    return {
      id,
      workspace_id: workspaceId,
      name: row.name,
      author: ref(row.authorAccountId),
      last_changed_by: ref(row.lastChangedByAccountId),
      last_changed_at: iso(row.lastChangedAt),
      created_at: iso(row.createdAt),
      status: row.status as LaunchedBroadcast['status'],
      text: row.text,
      audience:
        row.audienceKind === 'group'
          ? { kind: 'group' }
          : { kind: 'tags', mode: row.tagMode!, tags: wireTags(stored) },
      launched_by: ref(row.launchedByAccountId!),
      launched_at: iso(row.launchedAt!),
      launch_breakdown: {
        audience_size: row.audienceSize!,
        blocked_count: row.blockedCount!,
        never_wrote_count: row.neverWroteCount!,
        recipient_count: row.recipientCount!,
      },
      stopped_by: row.stoppedByAccountId === null ? null : ref(row.stoppedByAccountId),
      stopped_at: isoOrNull(row.stoppedAt),
      ended_at: isoOrNull(row.endedAt),
      end_reason: row.endReason,
      totals,
      not_reached_count: notReached,
    };
  }

  /** A draft's live size (its group rows or its tag audience's matches); a launched one's frozen size. */
  async function listedSize(row: BroadcastRecord): Promise<number> {
    if (row.status !== 'draft') return row.audienceSize!;
    if (row.audienceKind === 'group') return groups.count(row.workspaceId, row.id);
    const { kept } = await currentTags(row.workspaceId, row.id);
    return (await contacts.audienceBreakdown(row.workspaceId, tagSpec(row, kept), null))
      .audienceSize;
  }

  const getBroadcast = async (workspaceId: string, broadcastId: string): Promise<Broadcast> => {
    const row = await found(workspaceId, broadcastId);
    return row.status === 'draft' ? draftOf(row) : launchedOf(row);
  };

  return {
    getBroadcast,

    async draftView(workspaceId, broadcastId) {
      const row = await found(workspaceId, broadcastId);
      if (row.status !== 'draft') throw new NotFoundError(NOT_FOUND);
      return draftOf(row);
    },

    async listBroadcasts(workspaceId) {
      const rows = await broadcasts.list(workspaceId);
      const [sizes, ref] = await Promise.all([
        Promise.all(rows.map(listedSize)),
        refs(
          workspaceId,
          rows.flatMap((r) => [r.authorAccountId, r.lastChangedByAccountId]),
        ),
      ]);
      const items = rows.map((r, i): BroadcastListItem => ({
        id: r.id,
        name: r.name,
        status: r.status,
        audience_kind: r.audienceKind,
        audience_size: sizes[i]!,
        author: ref(r.authorAccountId),
        last_changed_by: ref(r.lastChangedByAccountId),
        last_changed_at: iso(r.lastChangedAt),
        launched_at: isoOrNull(r.launchedAt),
        ended_at: isoOrNull(r.endedAt),
      }));
      return { workspace_id: workspaceId, items };
    },

    async listRecipients(workspaceId, broadcastId, q) {
      const state = q.state ?? null;
      let after: number | undefined;
      if (q.after !== undefined) {
        after = decodeRecipientCursor(q.after, state) ?? undefined;
        if (after === undefined) throw new ValidationError('The cursor is not valid.');
      }
      const row = await found(workspaceId, broadcastId);
      const empty = {
        workspace_id: workspaceId,
        broadcast_id: broadcastId,
        state,
        has_prev: after !== undefined,
      };
      if (row.status === 'draft') {
        return { ...empty, items: [], has_next: false, next_cursor: null };
      }
      const page = await recipients.page(
        workspaceId,
        broadcastId,
        { ...(after !== undefined && { after }), ...(q.state && { state: q.state }) },
        RECIPIENT_PAGE_SIZE,
      );
      const cards = new Map(
        (
          await contacts.contactCards(
            workspaceId,
            page.rows.map((r) => r.contactId),
            null,
          )
        ).map((c) => [c.id, c]),
      );
      const last = page.rows.at(-1);
      return {
        ...empty,
        items: page.rows.map((r) => {
          const c = cards.get(r.contactId);
          return {
            id: r.id,
            position: r.position,
            contact: {
              id: r.contactId,
              first_name: c?.firstName ?? '',
              last_name: c?.lastName ?? null,
              username: c?.username ?? null,
            },
            state: r.state,
            failure_reason: r.failureReason,
            outcome_at: isoOrNull(r.outcomeAt),
          };
        }),
        has_next: page.hasNext,
        next_cursor: page.hasNext && last ? encodeRecipientCursor(last.position, state) : null,
      };
    },

    async itemDetails(workspaceId, broadcastIds) {
      const rows = (
        await Promise.all([...new Set(broadcastIds)].map((id) => broadcasts.find(workspaceId, id)))
      ).filter((r): r is BroadcastRecord => r !== null && r.launchedByAccountId !== null);
      const ref = await refs(
        workspaceId,
        rows.map((r) => r.launchedByAccountId),
      );
      return rows.map((r) => ({
        broadcast_id: r.id,
        broadcast_name: r.name,
        text: r.text,
        launched_by: ref(r.launchedByAccountId!),
      }));
    },
  };
}
