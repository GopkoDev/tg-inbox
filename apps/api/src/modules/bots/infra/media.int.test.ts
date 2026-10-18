import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { createTelegramGateway } from './telegram-gateway.js';

const TOKEN = '100001:TEST-media-token-not-real-aaaaaaaaaaaaaaaa';
const MB = 1024 * 1024;
const expectedByte = (i: number) => (i * 31 + 7) & 0xff;

async function read(body: AsyncIterable<Buffer | Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe('Telegram gateway openFile (against the fake Bot API)', () => {
  let fake: FakeTelegram;
  let gateway: ReturnType<typeof createTelegramGateway>;
  const output: string[] = [];

  beforeAll(async () => {
    fake = await startFakeTelegram();
    gateway = createTelegramGateway({ apiRoot: fake.apiRoot, maxConnections: 7 });
  });
  afterAll(async () => {
    await fake.stop();
  });
  beforeEach(async () => {
    await fake.reset();
    output.length = 0;
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        output.push(args.map(String).join(' '));
      });
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    const printed = output.join('\n');
    expect(printed).not.toContain(TOKEN);
    expect(printed).not.toContain('/bot');
  });

  const script = (files: Parameters<ReturnType<FakeTelegram['bot']>['script']>[0]['files']) =>
    fake.bot(TOKEN).script({ files });

  it('streams a 5 MB file whole as 200', async () => {
    await script({ f1: { path: 'photos/a.jpg', size: 5 * MB } });
    const result = await gateway.openFile(TOKEN, 'f1', undefined);
    if (result.outcome !== 'stream') throw new Error(`unexpected ${result.outcome}`);
    expect(result.status).toBe(200);
    expect(result.contentLength).toBe(5 * MB);
    expect(result.contentRange).toBeUndefined();
    const bytes = await read(result.body);
    expect(bytes.length).toBe(5 * MB);
    expect(bytes[0]).toBe(expectedByte(0));
    expect(bytes[4_000_000]).toBe(expectedByte(4_000_000));
    // The result carries neither the token nor a Telegram address.
    const rest = { ...result, body: undefined };
    expect(JSON.stringify(rest)).not.toContain(TOKEN);
    expect(JSON.stringify(rest)).not.toContain('http');
  });

  it('forwards a Range: 206 with the bytes and Content-Range', async () => {
    await script({ f1: { path: 'voice/a.ogg', size: 1000 } });
    const result = await gateway.openFile(TOKEN, 'f1', 'bytes=100-199');
    if (result.outcome !== 'stream') throw new Error(`unexpected ${result.outcome}`);
    expect(result.status).toBe(206);
    expect(result.contentLength).toBe(100);
    expect(result.contentRange).toBe('bytes 100-199/1000');
    const bytes = await read(result.body);
    expect(bytes.length).toBe(100);
    expect(bytes[0]).toBe(expectedByte(100));
  });

  it('ignores a range it cannot forward as a single range', async () => {
    await script({ f1: { path: 'voice/a.ogg', size: 1000 } });
    const result = await gateway.openFile(TOKEN, 'f1', 'bytes=0-1,5-9');
    if (result.outcome !== 'stream') throw new Error(`unexpected ${result.outcome}`);
    expect(result.status).toBe(200);
    await read(result.body);
  });

  it('a range beyond the end is range_not_satisfiable', async () => {
    await script({ f1: { path: 'voice/a.ogg', size: 1000 } });
    expect(await gateway.openFile(TOKEN, 'f1', 'bytes=5000-')).toEqual({
      outcome: 'range_not_satisfiable',
    });
  });

  it('getFile too big is too_large', async () => {
    await script({ f1: 'too_big' });
    expect(await gateway.openFile(TOKEN, 'f1', undefined)).toEqual({ outcome: 'too_large' });
  });

  it('a getFile size over 20 MiB is too_large without downloading', async () => {
    await script({ f1: { path: 'documents/big.bin', size: 21 * MB } });
    expect(await gateway.openFile(TOKEN, 'f1', undefined)).toEqual({ outcome: 'too_large' });
  });

  it('a file Telegram no longer has is gone', async () => {
    await script({ f1: 'not_found' });
    expect(await gateway.openFile(TOKEN, 'f1', undefined)).toEqual({ outcome: 'gone' });
  });

  it('a download 404 is gone', async () => {
    await script({ f1: { path: 'photos/a.jpg', size: 10 } });
    const first = await gateway.openFile(TOKEN, 'f1', undefined);
    if (first.outcome === 'stream') await read(first.body);
    // Same path now unknown to the file server.
    await script({ f1: { path: 'photos/a.jpg', size: 10 } });
    await script({});
    expect(await gateway.openFile(TOKEN, 'f1', undefined)).toEqual({ outcome: 'gone' });
  });

  it('an unknown token is unauthorized', async () => {
    expect(
      await gateway.openFile('999:UNKNOWN-token-aaaaaaaaaaaaaaaaaaaaaaaa', 'f1', undefined),
    ).toEqual({ outcome: 'unauthorized' });
  });

  it('caches the file path per file: one getFile for two opens', async () => {
    await script({ f1: { path: 'photos/a.jpg', size: 10 } });
    for (let i = 0; i < 2; i++) {
      const r = await gateway.openFile(TOKEN, 'f1', undefined);
      if (r.outcome !== 'stream') throw new Error(r.outcome);
      await read(r.body);
    }
    expect((await fake.calls(TOKEN)).filter((c) => c.method === 'getFile')).toHaveLength(1);
  });

  describe('a misbehaving Bot API', () => {
    let server: Server;
    let mode: 'getfile_500' | 'getfile_hang' | 'getfile_429' | 'stall' | 'download_500';
    let root: string;

    beforeAll(async () => {
      server = createServer((req, res) => {
        if (req.url?.includes('/getFile')) {
          if (mode === 'getfile_500') return void res.writeHead(500).end('{}');
          if (mode === 'getfile_429') return void res.writeHead(429).end('{}');
          if (mode === 'getfile_hang') return;
          res.writeHead(200, { 'content-type': 'application/json' });
          return void res.end(
            JSON.stringify({
              ok: true,
              result: { file_id: 'f', file_path: 'x/y.bin', file_size: 100 },
            }),
          );
        }
        if (mode === 'download_500') return void res.writeHead(502).end();
        res.writeHead(200, { 'content-length': 100 });
        res.write(Buffer.alloc(10));
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    });

    const gw = () =>
      createTelegramGateway({
        apiRoot: root,
        maxConnections: 1,
        getFileTimeoutMs: 150,
        downloadIdleTimeoutMs: 150,
      });

    it.each(['getfile_500', 'getfile_429', 'getfile_hang', 'download_500'] as const)(
      '%s is unavailable',
      async (m) => {
        mode = m;
        expect(await gw().openFile(TOKEN, 'f-' + m, undefined)).toEqual({ outcome: 'unavailable' });
      },
    );

    it('a download that stalls mid-body errors the stream after the idle timeout', async () => {
      mode = 'stall';
      const r = await gw().openFile(TOKEN, 'f-stall', undefined);
      if (r.outcome !== 'stream') throw new Error(r.outcome);
      await expect(read(r.body)).rejects.toThrow();
    });
  });
});
