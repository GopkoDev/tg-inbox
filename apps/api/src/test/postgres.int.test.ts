import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStop, startTestDatabase } from './postgres.js';

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const exists = (id: string) => docker('ps', '-aq', '--no-trunc', '--filter', `id=${id}`) !== '';

describe('startTestDatabase cleanup', () => {
  it('stop() removes the container, leaves no volume, and is idempotent', async () => {
    const db = await startTestDatabase();
    const id = db.containerId;
    try {
      expect(id).toBeTruthy();
      expect(exists(id)).toBe(true);
      expect(docker('inspect', '-f', '{{range .Mounts}}{{.Type}} {{end}}', id)).not.toContain(
        'volume',
      );
      await db.stop();
      expect(exists(id)).toBe(false);
      await expect(db.stop()).resolves.toBeUndefined();
    } finally {
      await db.stop().catch(() => undefined);
    }
  }, 120_000);

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

  it('removes the container when a migration fails', async () => {
    const label = `t42-${Date.now()}`;
    const dir = mkdtempSync(join(tmpdir(), 'bad-migrations-'));
    writeFileSync(
      join(dir, '0001_bad.ts'),
      `export async function up() { throw new Error('boom'); }\nexport async function down() {}\n`,
    );
    await expect(
      startTestDatabase({ migrationFolder: dir, labels: { t42: label } }),
    ).rejects.toThrow();
    expect(docker('ps', '-aq', '--filter', `label=t42=${label}`)).toBe('');
  }, 120_000);
});
