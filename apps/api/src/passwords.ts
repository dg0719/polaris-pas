import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password storage for the demo. Credentials are not a real security boundary
 * here (the seeded logins are printed on the sign-in screen), but there is no
 * excuse for plaintext: scrypt with a per-user salt costs nothing to do
 * properly and means the stored value is never the password itself.
 *
 * What this deliberately does NOT have: rate limiting, lockout, password
 * rotation, or any notion of a session that can be revoked.
 */

const KEY_LENGTH = 64;

export interface StoredPassword {
  hash: string;
  salt: string;
}

export function hashPassword(password: string): StoredPassword {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, KEY_LENGTH).toString('hex') };
}

/** Constant-time comparison, so a wrong password cannot be found by timing. */
export function verifyPassword(password: string, stored: StoredPassword): boolean {
  const expected = Buffer.from(stored.hash, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = scryptSync(password, stored.salt, KEY_LENGTH);
  return timingSafeEqual(expected, actual);
}
