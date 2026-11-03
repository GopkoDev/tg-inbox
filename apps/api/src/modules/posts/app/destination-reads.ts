import type { DestinationList } from '@tg/shared';
import type { DestinationRepo } from '../infra/destination-repo.js';
import type { PostRepo } from '../infra/post-repo.js';

export interface DestinationReadsDeps {
  destinations: Pick<DestinationRepo, 'listLive'>;
  posts: Pick<PostRepo, 'list'>;
  workspaces: {
    displayNames(workspaceId: string, accountIds: string[]): Promise<Map<string, string>>;
  };
  workspaceSettings: { timeZone(workspaceId: string): Promise<string | null> };
  currentBotId(workspaceId: string): Promise<bigint | null>;
}

export function createDestinationReads(deps: DestinationReadsDeps) {
  const { destinations, posts, workspaces, workspaceSettings, currentBotId } = deps;
  return {
    async listDestinations(workspaceId: string): Promise<DestinationList> {
      const [rows, scheduled, timeZone, botId] = await Promise.all([
        destinations.listLive(workspaceId),
        posts.list(workspaceId, { states: ['scheduled'] }),
        workspaceSettings.timeZone(workspaceId),
        currentBotId(workspaceId),
      ]);
      const names = await workspaces.displayNames(workspaceId, [
        ...new Set(rows.map((d) => d.connectedByAccountId)),
      ]);
      const counts = new Map<string, number>();
      for (const p of scheduled) {
        if (p.destinationId) counts.set(p.destinationId, (counts.get(p.destinationId) ?? 0) + 1);
      }
      return {
        workspace_id: workspaceId,
        time_zone: timeZone,
        scheduled_total: scheduled.length,
        items: rows.map((d) => {
          const foreign = botId !== null && d.telegramBotId !== botId;
          return {
            id: d.id,
            kind: d.kind,
            title: d.title,
            username: d.username,
            availability: foreign ? ('unavailable' as const) : d.availability,
            problem: foreign ? ('not_current_bot' as const) : d.problem,
            scheduled_count: counts.get(d.id) ?? 0,
            connected_by: {
              account_id: d.connectedByAccountId,
              display_name: names.get(d.connectedByAccountId) ?? 'Former member',
            },
            connected_at: d.connectedAt.toISOString(),
          };
        }),
      };
    },
  };
}

export type DestinationReads = ReturnType<typeof createDestinationReads>;
