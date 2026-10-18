import { sql, type Transaction } from 'kysely';
import type { Logger } from 'pino';
import pg from 'pg';
import { z } from 'zod';
import type { DB } from './db.types.gen.js';

export const REALTIME_CHANNEL = 'realtime';
// Postgres caps a NOTIFY payload at 8 000 bytes; signals stay far below it (ADR-0003).
export const MAX_SIGNAL_BYTES = 1000;

const id = z.uuid();

const conversationChanged = z
  .object({
    type: z.literal('conversation.changed'),
    v: z.literal(1),
    workspace_id: id,
    conversation_id: id,
    item: z.object({ type: z.enum(['message', 'reply', 'activity']), id }).nullable(),
    change: z.enum(['created', 'edited', 'state', 'read']),
    account_id: id.optional(),
  })
  .superRefine((s, ctx) => {
    if (s.change === 'read') {
      if (s.account_id === undefined) {
        ctx.addIssue({ code: 'custom', path: ['account_id'], message: 'required for read' });
      }
    } else if (s.item === null) {
      ctx.addIssue({ code: 'custom', path: ['item'], message: 'null only for read' });
    }
    if (s.item?.type === 'activity' && s.change !== 'created') {
      ctx.addIssue({ code: 'custom', path: ['change'], message: 'activity is created only' });
    }
  });

const botChanged = z.object({
  type: z.literal('bot.changed'),
  v: z.literal(1),
  workspace_id: id,
});

const membershipDeactivated = z.object({
  type: z.literal('membership.deactivated'),
  v: z.literal(1),
  workspace_id: id,
  account_id: id,
});

export const realtimeSignalSchema = z.discriminatedUnion('type', [
  conversationChanged,
  botChanged,
  membershipDeactivated,
]);

export type RealtimeSignal = z.infer<typeof realtimeSignalSchema>;

/** Emits a signal inside the caller's transaction: it is delivered only if that transaction commits. */
export async function publish(trx: Transaction<DB>, signal: RealtimeSignal): Promise<void> {
  const parsed = realtimeSignalSchema.parse(signal);
  const payload = JSON.stringify(parsed);
  if (Buffer.byteLength(payload) > MAX_SIGNAL_BYTES) {
    throw new Error(`realtime signal exceeds ${MAX_SIGNAL_BYTES} bytes`);
  }
  await sql`select pg_notify(${REALTIME_CHANNEL}, ${payload})`.execute(trx);
}

export interface RealtimeListener {
  onSignal(handler: (signal: RealtimeSignal) => void): void;
  /** Fires after a reconnect: signals may have been missed, so clients must resynchronise. */
  onGap(handler: () => void): void;
  stop(): Promise<void>;
}

export async function startRealtimeListener(
  connectionString: string,
  logger: Pick<Logger, 'info' | 'warn' | 'error'>,
  opts: { reconnectDelayMs?: number } = {},
): Promise<RealtimeListener> {
  const baseDelay = opts.reconnectDelayMs ?? 500;
  const maxDelay = Math.max(baseDelay, 30_000);
  const signalHandlers: Array<(s: RealtimeSignal) => void> = [];
  const gapHandlers: Array<() => void> = [];
  let stopped = false;
  let client: pg.Client | null = null;
  let timer: NodeJS.Timeout | null = null;
  let wake: (() => void) | null = null;

  const handleMessage = (raw: string | undefined) => {
    let data: unknown;
    try {
      data = JSON.parse(raw ?? '');
    } catch {
      logger.warn('realtime payload dropped: not JSON');
      return;
    }
    const parsed = realtimeSignalSchema.safeParse(data);
    if (!parsed.success) {
      const type = (data as { type?: unknown } | null)?.type;
      logger.warn(
        { signalType: typeof type === 'string' ? type.slice(0, 64) : undefined },
        'realtime payload dropped: failed schema',
      );
      return;
    }
    for (const h of signalHandlers) {
      try {
        h(parsed.data);
      } catch (err) {
        logger.error({ err, signalType: parsed.data.type }, 'realtime handler failed');
      }
    }
  };

  const connect = async (): Promise<pg.Client> => {
    const c = new pg.Client({ connectionString });
    c.on('notification', (m) => handleMessage(m.payload));
    c.on('error', (err) =>
      logger.warn({ code: (err as { code?: string }).code }, 'realtime connection error'),
    );
    c.on('end', () => {
      if (client === c) client = null;
      if (!stopped) wake?.();
    });
    await c.connect();
    try {
      await c.query(`LISTEN ${REALTIME_CHANNEL}`);
    } catch (err) {
      c.removeAllListeners('end');
      await c.end().catch(() => undefined);
      throw err;
    }
    return c;
  };

  client = await connect();

  const supervise = async () => {
    while (!stopped) {
      if (client) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        continue;
      }
      let delay = baseDelay;
      while (!stopped && !client) {
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, delay);
        });
        timer = null;
        if (stopped) return;
        try {
          const c = await connect();
          if (stopped) {
            c.removeAllListeners('end');
            await c.end().catch(() => undefined);
            return;
          }
          client = c;
          logger.info('realtime listener reconnected');
          for (const h of gapHandlers) {
            try {
              h();
            } catch (err) {
              logger.error({ err }, 'realtime gap handler failed');
            }
          }
        } catch (err) {
          logger.warn({ code: (err as { code?: string }).code }, 'realtime reconnect failed');
          delay = Math.min(delay * 2, maxDelay);
        }
      }
    }
  };
  void supervise();

  return {
    onSignal: (h) => void signalHandlers.push(h),
    onGap: (h) => void gapHandlers.push(h),
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      wake?.();
      const c = client;
      client = null;
      if (c) {
        c.removeAllListeners('end');
        await c.end().catch(() => undefined);
      }
    },
  };
}
