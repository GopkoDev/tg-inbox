import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordHasher } from '../app/ports.js';

const argon2Async = promisify(argon2);

export interface Argon2Params {
  memoryKib: number;
  passes: number;
  parallelism: number;
}

/** OWASP-recommended argon2id baseline (19 MiB, 2 passes, 1 lane). */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = { memoryKib: 19_456, passes: 2, parallelism: 1 };

const SALT_BYTES = 16;
const TAG_BYTES = 32;
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');

async function derive(password: string, salt: Buffer, params: Argon2Params, tagLength: number) {
  return argon2Async('argon2id', {
    message: password,
    nonce: salt,
    parallelism: params.parallelism,
    tagLength,
    memory: params.memoryKib,
    passes: params.passes,
  });
}

/** argon2id via `node:crypto`; hashes are self-describing PHC strings so parameters can change later. */
export function createPasswordHasher(params: Argon2Params = DEFAULT_ARGON2_PARAMS): PasswordHasher {
  async function hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const tag = await derive(password, salt, params, TAG_BYTES);
    return `$argon2id$v=19$m=${params.memoryKib},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tag)}`;
  }

  async function verify(passwordHash: string, password: string): Promise<boolean> {
    const m = PHC.exec(passwordHash);
    if (!m) return false;
    const stored = Buffer.from(m[5]!, 'base64');
    try {
      const tag = await derive(
        password,
        Buffer.from(m[4]!, 'base64'),
        { memoryKib: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]) },
        stored.length,
      );
      return tag.length === stored.length && timingSafeEqual(tag, stored);
    } catch {
      return false;
    }
  }

  let dummy: Promise<string> | undefined;

  return {
    hash,
    verify,
    async verifyDummy(password) {
      dummy ??= hash(randomBytes(16).toString('hex'));
      await verify(await dummy, password);
      return false;
    },
  };
}
