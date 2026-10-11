import { createServer, type IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { telegramApi } from './telegram.js';

describe('telegramApi', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('sends Bot API calls to the given apiRoot', async () => {
    const seen: string[] = [];
    const server = createServer((req: IncomingMessage, res) => {
      seen.push(req.url ?? '');
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          ok: true,
          result: { id: 1, is_bot: true, first_name: 'Test Bot 1', username: 'test_bot_1' },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => new Promise((resolve) => server.close(() => resolve()));
    const { port } = server.address() as { port: number };

    const me = await telegramApi('1:FAKE', { apiRoot: `http://127.0.0.1:${port}` }).getMe();

    expect(me.username).toBe('test_bot_1');
    expect(seen).toEqual(['/bot1:FAKE/getMe']);
  });
});
