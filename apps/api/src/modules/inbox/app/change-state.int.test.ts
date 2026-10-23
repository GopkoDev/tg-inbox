import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeps } from '../../../deps.js';
import { fixedClock } from '../../../platform/clock.js';
import { CloseNeedsConfirmationError } from '../../../platform/errors.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { createStateChanges } from '../../conversations/app/state-changes.js';
import { createActivityRepo } from '../../conversations/infra/activity-repo.js';
import { createConversationRepo } from '../../conversations/infra/conversation-repo.js';
import { createConversationSignals } from '../../conversations/infra/conversation-signals.js';
import { createChangeState } from './change-state.js';

const NOW = new Date('2026-10-18T10:00:00Z');

describe('change state: the refusal echoes what the row lock checked (postgres)', () => {
  let database: TestDatabase;
  let deps: ReturnType<typeof buildDeps>;

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url), { clock: fixedClock(NOW) });
  });
  afterAll(async () => {
    await deps?.destroy();
    await database?.stop();
  });

  const inbound = (messageId: bigint) => ({
    chatId: 7001n,
    messageId,
    kind: 'text' as const,
    body: `m${messageId}`,
    sentAt: new Date(NOW.getTime() - 60_000 + Number(messageId) * 1000),
    sender: {
      telegramUserId: 7001n,
      firstName: 'Olena',
      lastName: null,
      username: 'olena',
      languageCode: 'uk',
    },
    raw: { message_id: Number(messageId), text: `m${messageId}` },
  });

  it('a capture committed between the change transaction and the summary read makes "close anyway" ask again (B1, AC-06)', async () => {
    const { db } = deps;
    const ws = await insertWorkspace(db);
    const { accountId } = await insertMembership(db, ws, {
      activeSince: new Date('2026-01-01T00:00:00Z'),
    });
    const member = { accountId, activeSince: new Date('2026-01-01T00:00:00Z') };
    expect(await deps.conversations.captureInbound(ws, inbound(1n))).toBe('captured');
    const { id } = await db
      .selectFrom('conversations')
      .select('id')
      .where('workspace_id', '=', ws)
      .executeTakeFirstOrThrow();

    // The capture lands after the refusal's transaction committed and before its summary is read.
    let interleave = true;
    const changeState = createChangeState({
      transaction: (fn) => db.transaction().execute(fn),
      workspaces: deps.workspaceAccess as never,
      changes: createStateChanges({
        conversations: createConversationRepo(db),
        activities: createActivityRepo(db),
        signals: createConversationSignals(),
        clock: deps.clock,
      }),
      reads: {
        async getConversation(workspaceId, who, conversationId) {
          if (interleave) {
            interleave = false;
            expect(await deps.conversations.captureInbound(ws, inbound(2n))).toBe('captured');
          }
          return deps.inboxReads.getConversation(workspaceId, who, conversationId);
        },
      },
      clock: deps.clock,
    });

    const before = await deps.inboxReads.getConversation(ws, member, id);
    const asked = (await changeState
      .close(ws, member, id, {
        expectedStateVersion: before.state_version,
        expectedCloseSnapshot: { customerMessageSeq: 1, latestReply: null },
        confirm: false,
      })
      .catch((e: unknown) => e)) as CloseNeedsConfirmationError;
    expect(asked).toBeInstanceOf(CloseNeedsConfirmationError);
    const echoed = (
      asked.details as {
        conversation: {
          state_version: number;
          close_snapshot: {
            customer_message_seq: number;
            latest_reply: { id: string; state: 'sent' } | null;
          };
        };
      }
    ).conversation;
    expect(echoed.close_snapshot.customer_message_seq).toBe(1);

    // "Close anyway" with what the refusal echoed: the second message was never shown, so it asks again.
    const again = await changeState
      .close(ws, member, id, {
        expectedStateVersion: echoed.state_version,
        expectedCloseSnapshot: {
          customerMessageSeq: echoed.close_snapshot.customer_message_seq,
          latestReply: echoed.close_snapshot.latest_reply,
        },
        confirm: true,
      })
      .catch((e: unknown) => e);
    expect(again).toBeInstanceOf(CloseNeedsConfirmationError);
    const row = await db
      .selectFrom('conversations')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('open');
  });
});
