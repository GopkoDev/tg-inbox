/**
 * bot-connection load test (spec §6 NFRs, test-plan §NFR validation (load)).
 *
 * Generator: a plain Node script over the built-in `fetch` (undici) with a per-bot in-flight cap —
 * no new tool. It boots everything it needs locally: an ephemeral Postgres (Testcontainers, so
 * Docker must run), the fake Bot API and the real `buildApp()` listening on a random port. Bots
 * are seeded directly (fixtures); their webhook secrets stay in memory. Deliveries are signed
 * POSTs to `/api/telegram/webhook/<bot id>`, at most `TELEGRAM_WEBHOOK_MAX_CONNECTIONS` in flight
 * per bot, like Telegram.
 *
 * Usage (from the repo root):
 *   pnpm --filter @tg/api load -- --scenario flood --profile smoke
 *   pnpm --filter @tg/api load -- --scenario all --profile smoke
 *   options: --scenario flood|throughput|owner-actions|settings-load|all (default all)
 *            --profile smoke|full (default smoke) · --variant a|b|both (flood only, default both)
 *
 * `smoke` runs every scenario for seconds — a local check that the script and the pipeline work.
 * `full` is the pre-pilot run on a production-like host (sad.md §11); it is not part of CI.
 *
 * Measured: capture latency per bot from the server's `ingest_ms` log lines (receipt → commit),
 * acknowledgement / action / settings latency from the server's `responseTime` request logs.
 * After every delivery scenario a completeness check compares sent and stored message ids per
 * bot. Exit code 1 on any server error, lost or duplicated message, or a missed threshold.
 */
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/platform/config.js';
import { createDb, type Db } from '../src/platform/db.js';
import { newId } from '../src/platform/ids.js';
import { startFakeTelegram, type FakeTelegram } from '../src/test/fake-telegram.js';
import { insertAccount, insertSession } from '../src/test/fixtures/auth.js';
import { fakeBotToken, insertBot } from '../src/test/fixtures/bots.js';
import { telegramEdit, telegramUpdate } from '../src/test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../src/test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../src/test/postgres.js';

type Profile = 'smoke' | 'full';
type ScenarioName = 'flood' | 'throughput' | 'owner-actions' | 'settings-load';

const PROFILES = {
  smoke: {
    flood: { bots: 10, floodRate: 20, otherRate: 3, seconds: 5 },
    throughput: { bots: 10, senders: 50, rate: 50, seconds: 5 },
    owner: { workspaces: 6, rate: 1, seconds: 9 },
    settings: { messages: 2_000, contacts: 100, rate: 20, seconds: 5 },
  },
  full: {
    flood: { bots: 10, floodRate: 20, otherRate: 3, seconds: 300 },
    throughput: { bots: 10, senders: 500, rate: 50, seconds: 600 },
    owner: { workspaces: 50, rate: 1, seconds: 300 },
    settings: { messages: 100_000, contacts: 5_000, rate: 20, seconds: 300 },
  },
} as const;

const THRESHOLDS = { captureP95: 2000, ackP95: 300, ownerActionP95: 3000, settingsP95: 300 };
const FAKE_TELEGRAM_LATENCY_MS = 300;

// ---------- environment ----------

interface LogLine {
  msg?: string;
  reqId?: string;
  req?: { url?: string; method?: string };
  res?: { statusCode?: number };
  responseTime?: number;
  ingest_ms?: number;
  botId?: string;
  outcome?: string;
}

interface Env {
  app: FastifyInstance;
  baseUrl: string;
  db: Db;
  fake: FakeTelegram;
  config: Config;
  lines: LogLine[];
}

async function startEnv(database: TestDatabase): Promise<Env> {
  const fake = await startFakeTelegram({ latencyMs: FAKE_TELEGRAM_LATENCY_MS });
  const config: Config = {
    ...testConfig(database.url),
    LOG_LEVEL: 'info',
    TELEGRAM_API_ROOT: fake.apiRoot,
  };
  const lines: LogLine[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const raw of chunk.toString().split('\n')) {
        if (!raw) continue;
        try {
          lines.push(JSON.parse(raw) as LogLine);
        } catch {
          // not a pino line
        }
      }
      done();
    },
  });
  const app = await buildApp(config, { logStream });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, baseUrl, db: createDb(database.url), fake, config, lines };
}

// ---------- measuring ----------

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

/** Server-side request durations from the request logs whose url matches, since `from`. */
function requestTimes(env: Env, from: number, match: (url: string, method: string) => boolean) {
  const urls = new Map<string, { url: string; method: string }>();
  const times: { url: string; ms: number; status: number }[] = [];
  for (const line of env.lines.slice(from)) {
    if (line.msg === 'incoming request' && line.reqId && line.req?.url) {
      urls.set(line.reqId, { url: line.req.url, method: line.req.method ?? '' });
    } else if (line.msg === 'request completed' && line.reqId) {
      const req = urls.get(line.reqId);
      if (req && match(req.url, req.method)) {
        times.push({ url: req.url, ms: line.responseTime ?? 0, status: line.res?.statusCode ?? 0 });
      }
    }
  }
  return times;
}

function captureTimes(env: Env, from: number, botId: string): number[] {
  return env.lines
    .slice(from)
    .filter(
      (l) => l.botId === botId && typeof l.ingest_ms === 'number' && l.outcome !== 'unauthorized',
    )
    .map((l) => l.ingest_ms!);
}

// ---------- seeding ----------

interface SeededBot {
  name: string;
  workspaceId: string;
  id: string;
  secret: string;
}

async function seedBots(env: Env, prefix: string, count: number): Promise<SeededBot[]> {
  const bots: SeededBot[] = [];
  for (let i = 0; i < count; i++) {
    const workspaceId = await insertWorkspace(env.db, `${prefix} ${i}`);
    // Connected now, so every message the generator dates "now" is inside the capture epoch.
    const inserted = await insertBot(env.db, {
      workspaceId,
      connectedAt: new Date(Date.now() - 5000),
      lastCheckedAt: new Date(),
    });
    // Health checks during the run see a healthy bot that delivers to us.
    env.fake.bot(inserted.token).script({
      webhookUrl: `${env.config.TELEGRAM_WEBHOOK_BASE_URL}/api/telegram/webhook/${inserted.bot.id}`,
    });
    bots.push({
      name: `${prefix}-${i}`,
      workspaceId,
      id: inserted.bot.id,
      secret: inserted.webhookSecret!,
    });
  }
  return bots;
}

// ---------- generator ----------

interface Sent {
  /** `<chat>:<message id>` of every new message sent (edits and redeliveries excluded). */
  ids: Set<string>;
  statuses: Map<number, number>;
  networkErrors: number;
}

const newSent = (): Sent => ({ ids: new Set(), statuses: new Map(), networkErrors: 0 });

/** Telegram-like: at most `cap` deliveries in flight for one bot, paced at `rate` per second. */
async function deliverStream(
  env: Env,
  bot: SeededBot,
  rate: number,
  seconds: number,
  next: (i: number) => { update: unknown; newId?: string },
  sent: Sent,
): Promise<void> {
  const total = Math.round(rate * seconds);
  const cap = env.config.TELEGRAM_WEBHOOK_MAX_CONNECTIONS;
  const start = performance.now();
  let index = 0;
  const worker = async () => {
    for (;;) {
      const i = index++;
      if (i >= total) return;
      const due = start + (i * 1000) / rate;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const { update, newId: id } = next(i);
      try {
        const res = await fetch(`${env.baseUrl}/api/telegram/webhook/${bot.id}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-telegram-bot-api-secret-token': bot.secret,
          },
          body: JSON.stringify(update),
        });
        await res.arrayBuffer();
        sent.statuses.set(res.status, (sent.statuses.get(res.status) ?? 0) + 1);
        if (res.status === 200 && id) sent.ids.add(id);
      } catch {
        sent.networkErrors += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: cap }, worker));
}

/** A generator of private messages from `senders` customers, with optional edits and redeliveries. */
function conversationStream(bot: SeededBot, senders: number, mix = { edits: 0, redeliveries: 0 }) {
  const lastMessage = new Map<number, number>();
  const history: unknown[] = [];
  let updateId = 1;
  const base = 800_000 + Math.floor(Math.random() * 100_000) * 1000;
  return (i: number): { update: unknown; newId?: string } => {
    const fromId = base + (i % senders);
    const now = Math.floor(Date.now() / 1000);
    const roll = Math.random();
    if (roll < mix.redeliveries && history.length > 0) {
      return { update: history[Math.floor(Math.random() * history.length)] };
    }
    const last = lastMessage.get(fromId);
    if (roll < mix.redeliveries + mix.edits && last !== undefined) {
      return {
        update: telegramEdit({
          updateId: updateId++,
          messageId: last,
          date: now,
          fromId,
          text: `edited ${bot.name} ${i}`,
          editDate: now,
        }),
      };
    }
    const messageId = (last ?? 0) + 1;
    lastMessage.set(fromId, messageId);
    const update = telegramUpdate({
      updateId: updateId++,
      messageId,
      date: now,
      fromId,
      text: `load ${bot.name} ${i}`,
    });
    if (history.length < 1000) history.push(update);
    return { update, newId: `${fromId}:${messageId}` };
  };
}

// ---------- checks ----------

interface Report {
  scenario: string;
  rows: Record<string, string | number>[];
  failures: string[];
}

async function completeness(env: Env, bot: SeededBot, sent: Sent) {
  const rows = await env.db
    .selectFrom('messages')
    .innerJoin('conversations', 'conversations.id', 'messages.conversation_id')
    .select([
      'conversations.telegram_chat_id as chat',
      'messages.telegram_message_id as id',
      (eb) => eb.fn.countAll<string>().as('n'),
    ])
    .where('messages.workspace_id', '=', bot.workspaceId)
    .groupBy(['conversations.telegram_chat_id', 'messages.telegram_message_id'])
    .execute();
  const stored = new Set(rows.map((r) => `${r.chat}:${r.id}`));
  const lost = [...sent.ids].filter((id) => !stored.has(id));
  const duplicated = rows.filter((r) => Number(r.n) > 1).map((r) => `${r.chat}:${r.id}`);
  return { lost, duplicated, stored: stored.size };
}

function serverErrors(sent: Sent): number {
  let n = sent.networkErrors;
  for (const [status, count] of sent.statuses) if (status !== 200) n += count;
  return n;
}

async function deliveryReport(
  env: Env,
  scenario: string,
  from: number,
  bots: { bot: SeededBot; sent: Sent; role: string }[],
  latencyBots: Set<string>,
): Promise<Report> {
  const report: Report = { scenario, rows: [], failures: [] };
  const acks = requestTimes(env, from, (url) => url.startsWith('/api/telegram/webhook/'));
  for (const { bot, sent, role } of bots) {
    const capture = p95(captureTimes(env, from, bot.id));
    const ack = p95(acks.filter((a) => a.url.endsWith(bot.id)).map((a) => a.ms));
    const { lost, duplicated, stored } = await completeness(env, bot, sent);
    const errors = serverErrors(sent);
    report.rows.push({
      bot: bot.name,
      role,
      sent: sent.ids.size,
      stored,
      lost: lost.length,
      duplicated: duplicated.length,
      errors,
      capture_p95_ms: Math.round(capture),
      ack_p95_ms: Math.round(ack),
    });
    if (errors > 0) report.failures.push(`${bot.name}: ${errors} non-200 deliveries`);
    if (lost.length > 0) report.failures.push(`${bot.name}: lost ${lost.slice(0, 10).join(', ')}`);
    if (duplicated.length > 0) {
      report.failures.push(`${bot.name}: duplicated ${duplicated.slice(0, 10).join(', ')}`);
    }
    if (latencyBots.has(bot.id)) {
      if (capture > THRESHOLDS.captureP95) {
        report.failures.push(`${bot.name}: capture p95 ${capture} ms > ${THRESHOLDS.captureP95}`);
      }
      if (ack > THRESHOLDS.ackP95) {
        report.failures.push(`${bot.name}: acknowledgement p95 ${ack} ms > ${THRESHOLDS.ackP95}`);
      }
    }
  }
  return report;
}

// ---------- scenarios ----------

async function flood(env: Env, profile: Profile, variant: 'a' | 'b'): Promise<Report> {
  const p = PROFILES[profile].flood;
  const bots = await seedBots(env, `Flood ${variant.toUpperCase()}`, p.bots);
  const [floodBot, ...others] = bots as [SeededBot, ...SeededBot[]];
  const from = env.lines.length;
  const runs = [
    {
      bot: floodBot,
      sent: newSent(),
      role: 'flood',
      rate: p.floodRate,
      senders: variant === 'a' ? 200 : 1,
    },
    ...others.map((bot) => ({
      bot,
      sent: newSent(),
      role: 'other',
      rate: p.otherRate,
      senders: 20,
    })),
  ];
  await Promise.all(
    runs.map((r) =>
      deliverStream(env, r.bot, r.rate, p.seconds, conversationStream(r.bot, r.senders), r.sent),
    ),
  );
  return deliveryReport(
    env,
    `flood (variant ${variant.toUpperCase()}: ${variant === 'a' ? '200 senders' : 'one sender'})`,
    from,
    runs,
    new Set(others.map((b) => b.id)),
  );
}

async function throughput(env: Env, profile: Profile): Promise<Report> {
  const p = PROFILES[profile].throughput;
  const bots = await seedBots(env, 'Throughput', p.bots);
  const from = env.lines.length;
  const runs = bots.map((bot) => ({ bot, sent: newSent(), role: 'mixed' }));
  const started = performance.now();
  await Promise.all(
    runs.map((r) =>
      deliverStream(
        env,
        r.bot,
        p.rate / p.bots,
        p.seconds,
        conversationStream(r.bot, Math.ceil(p.senders / p.bots), {
          edits: 0.1,
          redeliveries: 0.01,
        }),
        r.sent,
      ),
    ),
  );
  const elapsed = (performance.now() - started) / 1000;
  const report = await deliveryReport(
    env,
    'throughput (10% edits, 1% redeliveries)',
    from,
    runs,
    new Set(bots.map((b) => b.id)),
  );
  const delivered = runs.reduce((n, r) => n + (r.sent.statuses.get(200) ?? 0), 0);
  const achieved = delivered / elapsed;
  report.rows.push({
    bot: 'all',
    role: 'rate',
    sent: delivered,
    achieved_per_s: Math.round(achieved * 10) / 10,
  });
  if (achieved < p.rate * 0.95)
    report.failures.push(`throughput ${achieved.toFixed(1)}/s < ${p.rate}/s`);
  return report;
}

async function ownerSession(env: Env, workspaceId: string) {
  const account = await insertAccount(env.db, { createdAt: new Date() });
  const session = await insertSession(env.db, account.id, { createdAt: new Date() });
  await insertMembership(env.db, workspaceId, { accountId: account.id, role: 'owner' });
  return `session=${session.token}`;
}

async function ownerActions(env: Env, profile: Profile): Promise<Report> {
  const p = PROFILES[profile].owner;
  let nextTelegramId = 7_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)) * 100n;
  const workspaces = await Promise.all(
    Array.from({ length: p.workspaces }, async (_, i) => {
      const workspaceId = await insertWorkspace(env.db, `Owner actions ${i}`);
      return { workspaceId, cookie: await ownerSession(env, workspaceId), step: 0, botId: 0n };
    }),
  );
  const from = env.lines.length;
  const total = Math.round(p.rate * p.seconds);
  const statuses = new Map<number, number>();
  const start = performance.now();
  const inFlight: Promise<void>[] = [];
  for (let k = 0; k < total; k++) {
    const wait = start + (k * 1000) / p.rate - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const w = workspaces[k % workspaces.length]!;
    // connect → rotate → disconnect, then again with a new bot.
    const step = w.step++ % 3;
    if (step === 0) w.botId = nextTelegramId++;
    const url = `${env.baseUrl}/api/workspaces/${w.workspaceId}/bot`;
    let request: Promise<Response>;
    if (step === 2) {
      request = fetch(`${url}/disconnect`, { method: 'POST', headers: { cookie: w.cookie } });
    } else {
      const token = fakeBotToken(w.botId);
      env.fake.bot(token).script({});
      request = fetch(`${url}/token`, {
        method: 'POST',
        headers: { cookie: w.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    }
    inFlight.push(
      request.then(
        async (res) => {
          await res.arrayBuffer();
          statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        },
        () => void statuses.set(0, (statuses.get(0) ?? 0) + 1),
      ),
    );
  }
  await Promise.all(inFlight);
  const times = requestTimes(
    env,
    from,
    (u, m) => m === 'POST' && /\/bot\/(token|disconnect)$/.test(u),
  );
  const p95ms = p95(times.map((t) => t.ms));
  const report: Report = {
    scenario: `owner actions (connect → rotate → disconnect, fake Bot API +${FAKE_TELEGRAM_LATENCY_MS} ms)`,
    rows: [
      {
        actions: total,
        ok: statuses.get(200) ?? 0,
        not_ok: total - (statuses.get(200) ?? 0),
        action_p95_ms: Math.round(p95ms),
      },
    ],
    failures: [],
  };
  if ((statuses.get(200) ?? 0) !== total) {
    report.failures.push(`owner actions: ${JSON.stringify(Object.fromEntries(statuses))}`);
  }
  if (p95ms > THRESHOLDS.ownerActionP95) {
    report.failures.push(`owner action p95 ${p95ms} ms > ${THRESHOLDS.ownerActionP95}`);
  }
  return report;
}

async function settingsLoad(env: Env, profile: Profile): Promise<Report> {
  const p = PROFILES[profile].settings;
  const [bot] = await seedBots(env, 'Settings load', 1);
  const workspaceId = bot!.workspaceId;
  const now = new Date();
  // Contacts, one conversation each, and the messages spread over them — in batches.
  const contactRows = Array.from({ length: p.contacts }, (_, i) => ({
    id: newId(),
    workspace_id: workspaceId,
    telegram_user_id: BigInt(600_000_000 + i),
    first_name: 'Load',
    last_name: null,
    username: null,
    language_code: null,
    profile_seen_at: now,
    created_at: now,
  }));
  const conversationRows = contactRows.map((c) => ({
    id: newId(),
    workspace_id: workspaceId,
    contact_id: c.id,
    telegram_chat_id: c.telegram_user_id,
    created_at: now,
    // every load message arrives at `now`, so arrival and activity are `now` too
    last_message_received_at: now,
    last_activity_at: now,
  }));
  for (let i = 0; i < contactRows.length; i += 1000) {
    await env.db
      .insertInto('contacts')
      .values(contactRows.slice(i, i + 1000))
      .execute();
    await env.db
      .insertInto('conversations')
      .values(conversationRows.slice(i, i + 1000))
      .execute();
  }
  for (let i = 0; i < p.messages; i += 1000) {
    const batch = Array.from({ length: Math.min(1000, p.messages - i) }, (_, j) => {
      const n = i + j;
      const conversation = conversationRows[n % conversationRows.length]!;
      return {
        id: newId(),
        workspace_id: workspaceId,
        conversation_id: conversation.id,
        telegram_message_id: BigInt(Math.floor(n / conversationRows.length) + 1),
        kind: 'text',
        body: 'load',
        telegram_message: JSON.stringify({}),
        sent_at: now,
        received_at: now,
      };
    });
    await env.db.insertInto('messages').values(batch).execute();
  }
  await sql`analyze`.execute(env.db);

  const cookie = await ownerSession(env, workspaceId);
  const from = env.lines.length;
  const total = Math.round(p.rate * p.seconds);
  const statuses = new Map<number, number>();
  const start = performance.now();
  const inFlight: Promise<void>[] = [];
  for (let k = 0; k < total; k++) {
    const wait = start + (k * 1000) / p.rate - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    inFlight.push(
      fetch(`${env.baseUrl}/api/workspaces/${workspaceId}/bot`, { headers: { cookie } }).then(
        async (res) => {
          await res.arrayBuffer();
          statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        },
        () => void statuses.set(0, (statuses.get(0) ?? 0) + 1),
      ),
    );
  }
  await Promise.all(inFlight);
  const times = requestTimes(env, from, (u, m) => m === 'GET' && u.endsWith(`/${workspaceId}/bot`));
  const p95ms = p95(times.map((t) => t.ms));
  const report: Report = {
    scenario: `bot settings load (${p.messages} messages, ${p.contacts} contacts)`,
    rows: [{ requests: total, ok: statuses.get(200) ?? 0, settings_p95_ms: Math.round(p95ms) }],
    failures: [],
  };
  if ((statuses.get(200) ?? 0) !== total) {
    report.failures.push(`settings: ${JSON.stringify(Object.fromEntries(statuses))}`);
  }
  if (p95ms > THRESHOLDS.settingsP95) {
    report.failures.push(`settings p95 ${p95ms} ms > ${THRESHOLDS.settingsP95}`);
  }
  return report;
}

// ---------- main ----------

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      scenario: { type: 'string', default: 'all' },
      profile: { type: 'string', default: 'smoke' },
      variant: { type: 'string', default: 'both' },
    },
  });
  const profile = values.profile as Profile;
  if (!(profile in PROFILES)) throw new Error(`unknown profile ${values.profile}`);
  const all: ScenarioName[] = ['flood', 'throughput', 'owner-actions', 'settings-load'];
  const scenarios = values.scenario === 'all' ? all : [values.scenario as ScenarioName];
  for (const s of scenarios) if (!all.includes(s)) throw new Error(`unknown scenario ${s}`);
  const variants: ('a' | 'b')[] =
    values.variant === 'both' ? ['a', 'b'] : [values.variant as 'a' | 'b'];

  console.log(`bot-connection load test — profile ${profile}; starting Postgres + fake Bot API…`);
  const database = await startTestDatabase();
  const env = await startEnv(database);
  const reports: Report[] = [];
  try {
    for (const scenario of scenarios) {
      if (scenario === 'flood')
        for (const v of variants) reports.push(await flood(env, profile, v));
      if (scenario === 'throughput') reports.push(await throughput(env, profile));
      if (scenario === 'owner-actions') reports.push(await ownerActions(env, profile));
      if (scenario === 'settings-load') reports.push(await settingsLoad(env, profile));
    }
  } finally {
    await env.app.close();
    await env.db.destroy();
    await env.fake.stop();
    await database.stop();
  }

  let failed = false;
  for (const report of reports) {
    console.log(`\n== ${report.scenario}`);
    console.table(report.rows);
    for (const f of report.failures) console.log(`  FAIL ${f}`);
    if (report.failures.length === 0) console.log('  PASS');
    failed ||= report.failures.length > 0;
  }
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
