import type { BroadcastStopped } from '@tg/shared';
import { AccessRemovedError, NotFoundError, OwnerOnlyError } from '../../../platform/errors.js';
import { canStop, type MemberRole } from '../domain/broadcast.js';
import type { BroadcastRepo, BroadcastView, Transaction, WorkspacesApi } from './ports.js';
import type { Settle } from './settle.js';

export interface StopBroadcastDeps {
  transaction: Transaction;
  broadcasts: Pick<BroadcastRepo, 'lockForUpdate'>;
  workspaces: Pick<WorkspacesApi, 'lockActiveMembers'>;
  settle: Pick<Settle, 'endInTx' | 'logEnded' | 'finishIfDone'>;
  views: BroadcastView;
}

export interface StopBroadcast {
  /** A business owner stops a sending broadcast: no send starts after the commit (AC-18). */
  stopBroadcast(
    workspaceId: string,
    actor: { accountId: string; role: MemberRole },
    broadcastId: string,
  ): Promise<BroadcastStopped>;
}

export function createStopBroadcast(deps: StopBroadcastDeps): StopBroadcast {
  const { transaction, broadcasts, workspaces, settle, views } = deps;
  return {
    async stopBroadcast(workspaceId, actor, broadcastId) {
      if (!canStop(actor.role)) throw new OwnerOnlyError('Only a business owner can stop.');
      const stopped = await transaction(async (tx) => {
        // Lock order (sad.md §8): the membership FOR SHARE, then the broadcast row.
        const active = await workspaces.lockActiveMembers(tx, workspaceId, [actor.accountId]);
        if (!active.includes(actor.accountId)) {
          throw new AccessRemovedError('Your access to this workspace was removed');
        }
        const row = await broadcasts.lockForUpdate(workspaceId, broadcastId, tx);
        if (row === null) throw new NotFoundError('Broadcast not found.');
        const done = await settle.endInTx(tx, row, {
          kind: 'stop',
          actorAccountId: actor.accountId,
        });
        return done ? row : null;
      });
      if (stopped !== null) {
        await settle.logEnded(stopped, 'stopped');
      } else {
        // Nothing waiting: the last outcome came first, so the broadcast may now be done.
        await settle.finishIfDone(workspaceId, broadcastId);
      }
      return {
        outcome: stopped !== null ? 'stopped' : 'unchanged',
        broadcast: await views.broadcastView(workspaceId, broadcastId),
      };
    },
  };
}
