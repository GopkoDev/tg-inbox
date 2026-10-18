import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../../platform/db.types.gen.js';
import type { UnitOfWork, WorkspaceRepos } from '../app/ports.js';
import { KyselyInvitationRepo } from './invitation-repo.js';
import { KyselyMembershipRepo } from './membership-repo.js';
import { KyselyWorkspaceRepo } from './workspace-repo.js';

export function workspaceRepos(db: Kysely<DB>): WorkspaceRepos {
  return {
    workspaces: new KyselyWorkspaceRepo(db),
    memberships: new KyselyMembershipRepo(db),
    invitations: new KyselyInvitationRepo(db),
  };
}

export class KyselyUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Kysely<DB>) {}

  run<T>(fn: (repos: WorkspaceRepos, tx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => fn(workspaceRepos(trx), trx));
  }

  reposOn(tx: Transaction<DB>): WorkspaceRepos {
    return workspaceRepos(tx);
  }
}
