import type {
  DestinationRef,
  MemberRef,
  Post,
  PostAttention,
  PostList,
  PostState,
  PostSummary,
} from '@tg/shared';
import type { Db } from '../../../platform/db.js';
import type { Clock } from '../../../platform/clock.js';
import { NotFoundError } from '../../../platform/errors.js';
import { telegramLink } from '../domain/telegram-link.js';
import type { DestinationRecord, DestinationRepo } from '../infra/destination-repo.js';
import type { PostRecord, PostRepo } from '../infra/post-repo.js';

export interface PostReadsDeps {
  posts: Pick<PostRepo, 'find' | 'list' | 'clearAttention' | 'countAttention'>;
  destinations: Pick<DestinationRepo, 'find'>;
  workspaces: {
    displayNames(workspaceId: string, accountIds: string[]): Promise<Map<string, string>>;
  };
  workspaceSettings: { timeZone(workspaceId: string): Promise<string | null> };
  currentBotId(workspaceId: string): Promise<bigint | null>;
  transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>;
  signals: { postChanged(tx: Db, workspaceId: string, postId: string): Promise<void> };
  clock: Clock;
}

const DELETE_WINDOW_MS = 48 * 3_600_000;
const TEXT_START_MAX = 120;
const LIST_MAX = 200;

export function createPostReads(deps: PostReadsDeps) {
  const { posts, destinations, workspaces, workspaceSettings, currentBotId } = deps;

  async function names(workspaceId: string, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((i): i is string => i !== null))];
    const map = await workspaces.displayNames(workspaceId, unique);
    return (id: string): MemberRef => ({
      account_id: id,
      display_name: map.get(id) ?? 'Former member',
    });
  }

  function destinationRef(d: DestinationRecord, botId: bigint | null): DestinationRef {
    const foreign = botId !== null && d.telegramBotId !== botId;
    return {
      id: d.id,
      kind: d.kind,
      title: d.title,
      username: d.username,
      availability: foreign ? 'unavailable' : d.availability,
      problem: foreign ? 'not_current_bot' : d.problem,
    };
  }

  async function destinationsOf(workspaceId: string, rows: PostRecord[]) {
    const botId = await currentBotId(workspaceId);
    const ids = [...new Set(rows.map((r) => r.destinationId).filter((i): i is string => !!i))];
    const found = new Map<string, DestinationRecord>();
    for (const id of ids) {
      const d = await destinations.find(workspaceId, id);
      if (d && !d.removedAt) found.set(id, d);
    }
    return (r: PostRecord) => {
      const d = r.destinationId ? found.get(r.destinationId) : undefined;
      return d ? { ref: destinationRef(d, botId), record: d } : null;
    };
  }

  const iso = (d: Date | null) => (d ? d.toISOString() : null);

  async function load(workspaceId: string, id: string): Promise<PostRecord> {
    const row = await posts.find(workspaceId, id);
    if (!row) throw new NotFoundError('Post not found');
    return row;
  }

  return {
    async listPosts(
      workspaceId: string,
      filter: { states?: PostState[]; needsAttention?: boolean },
    ): Promise<PostList> {
      const fetched = await posts.list(workspaceId, { ...filter, limit: LIST_MAX + 1 });
      const truncated = fetched.length > LIST_MAX;
      const rows = fetched.slice(0, LIST_MAX);
      const [timeZone, who, dest] = await Promise.all([
        workspaceSettings.timeZone(workspaceId),
        names(
          workspaceId,
          rows.map((r) => r.lastChangedByAccountId),
        ),
        destinationsOf(workspaceId, rows),
      ]);
      const items: PostSummary[] = rows.map((r) => ({
        id: r.id,
        text_start: r.text.slice(0, TEXT_START_MAX),
        destination: dest(r)?.ref ?? null,
        state: r.state,
        scheduled_for: iso(r.scheduledFor),
        published_at: iso(r.publishedAt),
        outcome_reason: r.outcomeReason as PostSummary['outcome_reason'],
        needs_attention: r.needsAttention,
        last_changed_by: who(r.lastChangedByAccountId),
        last_changed_at: r.lastChangedAt.toISOString(),
      }));
      return { workspace_id: workspaceId, time_zone: timeZone, truncated, items };
    },

    async getPost(workspaceId: string, id: string): Promise<Post> {
      const r = await load(workspaceId, id);
      const [who, dest] = await Promise.all([
        names(workspaceId, [
          r.authorAccountId,
          r.lastChangedByAccountId,
          r.scheduledByAccountId,
          r.deletedByAccountId,
        ]),
        destinationsOf(workspaceId, [r]),
      ]);
      const d = dest(r);
      const published = r.state === 'published' && r.publishedAt !== null;
      return {
        id: r.id,
        workspace_id: workspaceId,
        state: r.state,
        version: r.version,
        text: r.text,
        silent: r.silent,
        destination: d?.ref ?? null,
        author: who(r.authorAccountId),
        last_changed_by: who(r.lastChangedByAccountId),
        last_changed_at: r.lastChangedAt.toISOString(),
        created_at: r.createdAt.toISOString(),
        schedule:
          r.scheduledFor && r.scheduledByAccountId && r.scheduleKind
            ? {
                kind: r.scheduleKind,
                scheduled_for: r.scheduledFor.toISOString(),
                scheduled_by: who(r.scheduledByAccountId),
              }
            : null,
        published_at: iso(r.publishedAt),
        telegram_link:
          published && d && r.telegramMessageId !== null
            ? telegramLink({
                username: d.record.username,
                chatId: d.record.chatId,
                messageId: Number(r.telegramMessageId),
              })
            : null,
        deletable_until: published
          ? new Date(r.publishedAt!.getTime() + DELETE_WINDOW_MS).toISOString()
          : null,
        outcome_reason: r.outcomeReason as Post['outcome_reason'],
        outcome_at: iso(r.outcomeAt),
        needs_attention: r.needsAttention,
        draft_notice: r.draftNotice,
        deleted_at: iso(r.deletedAt),
        deleted_by: r.deletedByAccountId ? who(r.deletedByAccountId) : null,
      };
    },

    async getPostAttention(workspaceId: string): Promise<PostAttention> {
      return { count: await posts.countAttention(workspaceId) };
    },

    async markPostSeen(
      workspaceId: string,
      id: string,
    ): Promise<{ outcome: 'seen' | 'unchanged' }> {
      await load(workspaceId, id);
      const cleared = await deps.transaction(async (tx) => {
        const done = await posts.clearAttention(workspaceId, id, tx);
        if (done) await deps.signals.postChanged(tx, workspaceId, id);
        return done;
      });
      return { outcome: cleared ? 'seen' : 'unchanged' };
    },
  };
}

export type PostReads = ReturnType<typeof createPostReads>;
