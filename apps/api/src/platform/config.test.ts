import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

const base = {
  DATABASE_URL: 'postgres://tg:tg@localhost:5432/tg',
  PUBLIC_WEB_URL: 'https://panel.example.test',
  BOT_TOKEN_ENCRYPTION_KEY: KEY,
};

function load(env: Record<string, string | undefined>) {
  return loadConfig(env as NodeJS.ProcessEnv);
}

function errorOf(env: Record<string, string | undefined>): Error {
  try {
    load(env);
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig — bot-connection keys', () => {
  it('defaults the webhook base url to PUBLIC_WEB_URL and leaves the api root unset', () => {
    const config = load({ ...base, DATABASE_POOL_MAX: '20' });
    expect(config.TELEGRAM_WEBHOOK_BASE_URL).toBe('https://panel.example.test');
    expect(config.TELEGRAM_WEBHOOK_MAX_CONNECTIONS).toBe(10);
    expect(config.TELEGRAM_API_ROOT).toBeUndefined();
  });

  it('keeps the default max connections below the default pool size', () => {
    const config = load(base);
    expect(config.DATABASE_POOL_MAX).toBe(10);
    expect(config.TELEGRAM_WEBHOOK_MAX_CONNECTIONS).toBeLessThan(config.DATABASE_POOL_MAX);
  });

  it('takes explicit values', () => {
    const config = load({
      ...base,
      DATABASE_POOL_MAX: '30',
      TELEGRAM_WEBHOOK_BASE_URL: 'https://hooks.example.test',
      TELEGRAM_WEBHOOK_MAX_CONNECTIONS: '25',
      TELEGRAM_API_ROOT: 'http://127.0.0.1:9999',
    });
    expect(config.TELEGRAM_WEBHOOK_BASE_URL).toBe('https://hooks.example.test');
    expect(config.TELEGRAM_WEBHOOK_MAX_CONNECTIONS).toBe(25);
    expect(config.TELEGRAM_API_ROOT).toBe('http://127.0.0.1:9999');
  });

  it('decodes the encryption key to 32 bytes with a stable derived key id', () => {
    const a = load(base).BOT_TOKEN_ENCRYPTION_KEY;
    const b = load(base).BOT_TOKEN_ENCRYPTION_KEY;
    expect(a.key).toEqual(Buffer.alloc(32, 7));
    expect(a.id).toMatch(/^[0-9a-f]{8}$/);
    expect(b.id).toBe(a.id);
    const other = load({
      ...base,
      BOT_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
    });
    expect(other.BOT_TOKEN_ENCRYPTION_KEY.id).not.toBe(a.id);
  });

  it.each([
    ['missing', undefined],
    ['not base64', 'not*base64*at*all!'],
    ['16 bytes', Buffer.alloc(16, 1).toString('base64')],
    ['33 bytes', Buffer.alloc(33, 1).toString('base64')],
  ])('rejects an encryption key that is %s, naming the key and never echoing it', (_n, value) => {
    const err = errorOf({ ...base, BOT_TOKEN_ENCRYPTION_KEY: value });
    expect(err.message).toContain('BOT_TOKEN_ENCRYPTION_KEY');
    if (value) expect(err.message).not.toContain(value);
  });

  it.each([
    ['equal to the pool size', '10', '10'],
    ['above the pool size', '10', '50'],
  ])('rejects max connections %s', (_n, pool, max) => {
    const err = errorOf({
      ...base,
      DATABASE_POOL_MAX: pool,
      TELEGRAM_WEBHOOK_MAX_CONNECTIONS: max,
    });
    expect(err.message).toContain('TELEGRAM_WEBHOOK_MAX_CONNECTIONS');
  });

  it.each(['0', '101', 'abc'])('rejects max connections %s outside 1-100', (max) => {
    const err = errorOf({
      ...base,
      DATABASE_POOL_MAX: '200',
      TELEGRAM_WEBHOOK_MAX_CONNECTIONS: max,
    });
    expect(err.message).toContain('TELEGRAM_WEBHOOK_MAX_CONNECTIONS');
  });

  it.each(['TELEGRAM_WEBHOOK_BASE_URL', 'TELEGRAM_API_ROOT'])(
    'rejects a %s that is not a url',
    (key) => {
      const err = errorOf({ ...base, [key]: 'not a url' });
      expect(err.message).toContain(key);
    },
  );
});
