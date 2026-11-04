import { randomBytes } from 'node:crypto';
import { hashToken } from '../../../platform/tokens.js';

export const CODE_TTL_MS = 10 * 60_000;
const PREFIX = 'tgp_';
const CODE_RE = /tgp_[A-Za-z0-9_-]+/;

export function hashCode(code: string): Buffer {
  return hashToken(code);
}

export function newCode(): { code: string; hash: Buffer } {
  const code = PREFIX + randomBytes(24).toString('base64url');
  return { code, hash: hashCode(code) };
}

/** A code from `/connect@<bot> tgp_…` (groups) or anywhere in the text (channel posts). */
export function parseCode(
  text: string,
  opts: { botUsername: string; channel?: boolean },
): string | null {
  if (opts.channel) return CODE_RE.exec(text)?.[0] ?? null;
  const m = /^\/connect@([A-Za-z0-9_]+)\s+(tgp_[A-Za-z0-9_-]+)/.exec(text.trim());
  if (!m || m[1]!.toLowerCase() !== opts.botUsername.toLowerCase()) return null;
  return m[2]!;
}
