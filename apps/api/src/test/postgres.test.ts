import { describe, expect, it } from 'vitest';
import { createStop } from './postgres.js';

describe('createStop', () => {
  it('createStop removes the container even when the disconnect wait rejects', async () => {
    let removed = 0;
    const stop = createStop(
      () => Promise.reject(new Error('wait failed')),
      async () => {
        removed++;
      },
    );
    await expect(stop()).rejects.toThrow('wait failed');
    expect(removed).toBe(1);
    await expect(stop()).rejects.toThrow('wait failed');
    expect(removed).toBe(1);
  });

  it('retries the removal on a later stop() when remove() rejected', async () => {
    let attempts = 0;
    const stop = createStop(
      async () => undefined,
      async () => {
        attempts++;
        if (attempts === 1) throw new Error('docker hiccup');
      },
    );
    await expect(stop()).rejects.toThrow('docker hiccup');
    await expect(stop()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it('keeps the original wait error when the removal fails too', async () => {
    const stop = createStop(
      () => Promise.reject(new Error('wait failed')),
      () => Promise.reject(new Error('remove failed')),
    );
    const error = await stop().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
      'wait failed',
      'remove failed',
    ]);
  });
});
