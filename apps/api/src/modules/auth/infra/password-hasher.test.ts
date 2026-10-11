import { describe, expect, it } from 'vitest';
import { createPasswordHasher } from './password-hasher.js';

const hasher = createPasswordHasher({ memoryKib: 64, passes: 1, parallelism: 1 });

describe('argon2id password hasher', () => {
  it('produces a PHC argon2id string', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=64,t=1,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(hash, 'wrong password!!')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hasher.hash('same-password')).not.toBe(await hasher.hash('same-password'));
  });

  it('verifies a hash made with other parameters (self-describing)', async () => {
    const other = createPasswordHasher({ memoryKib: 128, passes: 2, parallelism: 1 });
    const hash = await other.hash('portable-password');
    expect(await hasher.verify(hash, 'portable-password')).toBe(true);
  });

  it('returns false for a malformed hash', async () => {
    expect(await hasher.verify('not-a-hash', 'whatever-password')).toBe(false);
  });

  it('verifyDummy runs a verification and returns false', async () => {
    expect(await hasher.verifyDummy('any-password-here')).toBe(false);
  });
});
