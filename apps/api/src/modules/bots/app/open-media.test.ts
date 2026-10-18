import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { botRow, createBotsHarness } from './harness.js';
import { createMarkNeedsToken } from './mark-needs-token.js';
import { createOpenMedia } from './open-media.js';
import { MAX_DOWNLOAD_BYTES } from './ports.js';

function setup(rows = [botRow()]) {
  const h = createBotsHarness(rows);
  const markNeedsToken = createMarkNeedsToken(h);
  const { openMedia } = createOpenMedia({ ...h, markNeedsToken });
  return { h, openMedia };
}
const req = { workspaceId: 'ws-a', fileReference: 'file-1', fileSize: 1000n };
const fileCalls = (h: ReturnType<typeof setup>['h']) =>
  h.telegram.calls.filter((c) => c.method === 'openFile');

describe('openMedia', () => {
  it('streams through the bot token and forwards the range', async () => {
    const { h, openMedia } = setup();
    const body = Readable.from([Buffer.from('abc')]);
    h.telegram.fileResult = {
      outcome: 'stream',
      body,
      status: 206,
      contentLength: 3,
      contentRange: 'bytes 0-2/10',
    };
    const result = await openMedia({ ...req, range: 'bytes=0-2' });
    expect(result).toEqual({
      outcome: 'stream',
      body,
      status: 206,
      contentLength: 3,
      contentRange: 'bytes 0-2/10',
    });
    expect(fileCalls(h)).toEqual([
      expect.objectContaining({
        token: h.bots.rows[0]!.token,
        fileReference: 'file-1',
        range: 'bytes=0-2',
      }),
    ]);
  });

  it.each([
    ['needs_token', 'bot_not_working'],
    ['disconnected', 'bot_not_connected'],
  ] as const)('a %s bot: unavailable %s, Telegram not called', async (state, reason) => {
    const { h, openMedia } = setup([
      botRow(
        state === 'disconnected'
          ? { state, token: null, webhookSecret: null, connectedAt: null }
          : { state },
      ),
    ]);
    expect(await openMedia(req)).toEqual({ outcome: 'unavailable', reason });
    expect(fileCalls(h)).toHaveLength(0);
  });

  it('no bot: bot_not_connected', async () => {
    const { h, openMedia } = setup([]);
    expect(await openMedia(req)).toEqual({ outcome: 'unavailable', reason: 'bot_not_connected' });
    expect(fileCalls(h)).toHaveLength(0);
  });

  it("another workspace's bot is never used", async () => {
    const { h, openMedia } = setup([botRow({ workspaceId: 'ws-b' })]);
    expect(await openMedia(req)).toEqual({ outcome: 'unavailable', reason: 'bot_not_connected' });
    expect(fileCalls(h)).toHaveLength(0);
  });

  it('a captured size over 20 MiB is file_too_large without a Telegram call', async () => {
    const { h, openMedia } = setup();
    const size = BigInt(MAX_DOWNLOAD_BYTES) + 1n;
    expect(await openMedia({ ...req, fileSize: size })).toEqual({
      outcome: 'unavailable',
      reason: 'file_too_large',
    });
    expect(fileCalls(h)).toHaveLength(0);
  });

  it('exactly 20 MiB and an unknown size are tried', async () => {
    const { h, openMedia } = setup();
    h.telegram.fileResult = { outcome: 'gone' };
    await openMedia({ ...req, fileSize: BigInt(MAX_DOWNLOAD_BYTES) });
    await openMedia({ ...req, fileSize: null });
    expect(fileCalls(h)).toHaveLength(2);
  });

  it.each([
    [{ outcome: 'too_large' }, { outcome: 'unavailable', reason: 'file_too_large' }],
    [{ outcome: 'gone' }, { outcome: 'unavailable', reason: 'file_gone' }],
    [{ outcome: 'unavailable' }, { outcome: 'telegram_unavailable' }],
    [{ outcome: 'range_not_satisfiable' }, { outcome: 'range_not_satisfiable' }],
  ] as const)('maps the gateway answer %j to %j', async (answer, expected) => {
    const { h, openMedia } = setup();
    h.telegram.fileResult = answer;
    expect(await openMedia(req)).toEqual(expected);
    expect(h.bots.rows[0]!.state).toBe('connected');
    expect(h.signals.published).toEqual([]);
  });

  it('a 401 flips the bot to needs_token, publishes bot.changed, answers bot_not_working', async () => {
    const { h, openMedia } = setup();
    h.telegram.fileResult = { outcome: 'unauthorized' };
    expect(await openMedia(req)).toEqual({ outcome: 'unavailable', reason: 'bot_not_working' });
    expect(h.bots.rows[0]!.state).toBe('needs_token');
    expect(h.signals.published).toEqual(['ws-a']);
  });

  it('an undecryptable token flips to needs_token without calling Telegram', async () => {
    const { h, openMedia } = setup([botRow({ undecryptable: true })]);
    expect(await openMedia(req)).toEqual({ outcome: 'unavailable', reason: 'bot_not_working' });
    expect(h.bots.rows[0]!.state).toBe('needs_token');
    expect(fileCalls(h)).toHaveLength(0);
  });
});
