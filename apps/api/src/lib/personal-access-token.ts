import { createHash, randomBytes } from "node:crypto";

export const PAT_PREFIX = "lopat_";
export const PAT_TOKEN_BYTES = 32;
export const MAX_TOKEN_DAYS = 90;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function toBase62(bytes: Buffer): string {
  let value = BigInt(`0x${bytes.toString("hex")}`);
  if (value === 0n) {
    return BASE62.charAt(0);
  }
  let out = "";
  while (value > 0n) {
    out = BASE62.charAt(Number(value % 62n)) + out;
    value /= 62n;
  }
  return out;
}

/** SHA-256 hex of the full token. Only the hash is ever persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a new personal access token. Returns the plaintext token (shown to
 * the caller exactly once), its hash, and a short identifying prefix of the
 * secret portion (the first 8 base62 characters).
 */
export function generateToken(): { token: string; tokenHash: string; prefix: string } {
  const secret = toBase62(randomBytes(PAT_TOKEN_BYTES));
  const token = `${PAT_PREFIX}${secret}`;
  return { token, tokenHash: hashToken(token), prefix: secret.slice(0, 8) };
}
