import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no ambiguous: 0/O, 1/I/L
const BODY_LENGTH = 12;
const CHECKSUM_LENGTH = 4;

/**
 * Generates a random gift card code with embedded checksum.
 * Format: XXXX-XXXX-XXXX-CHCK (12-char body + 4-char HMAC-SHA256 checksum).
 * Optional prefix: PREFIX-XXXX-XXXX-XXXX-CHCK.
 */
export function generateCode(prefix: string | undefined, programSecret: string): string {
  const body = generateRandomString(BODY_LENGTH);
  const checksum = computeChecksum(body, programSecret);
  const code = body + checksum;
  return prefix ? `${prefix}${code}` : code;
}

/**
 * Validates the checksum embedded in a gift card code.
 * Uses timing-safe comparison.
 */
export function validateChecksum(code: string, programSecret: string): boolean {
  const normalized = normalizeCode(code);
  if (normalized.length < BODY_LENGTH + CHECKSUM_LENGTH) return false;

  const body = normalized.slice(0, BODY_LENGTH);
  const checksum = normalized.slice(BODY_LENGTH, BODY_LENGTH + CHECKSUM_LENGTH);
  const expected = computeChecksum(body, programSecret);

  return timingSafeEqual(Buffer.from(checksum), Buffer.from(expected));
}

/**
 * Normalizes a code: uppercase, strip dashes and whitespace.
 */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Formats a normalized code with dashes: XXXX-XXXX-XXXX-CHCK
 */
export function formatCode(code: string): string {
  const normalized = normalizeCode(code);
  const segments: string[] = [];
  for (let i = 0; i < normalized.length; i += 4) {
    segments.push(normalized.slice(i, i + 4));
  }
  return segments.join("-");
}

function generateRandomString(length: number): string {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    const idx1 = (bytes[i] ?? 0) % ALPHABET.length;
    result += ALPHABET[idx1] ?? ALPHABET.charAt(0);
  }
  return result;
}

function computeChecksum(body: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  const digest = hmac.digest();
  let result = "";
  for (let i = 0; i < CHECKSUM_LENGTH; i++) {
    const idx2 = (digest[i] ?? 0) % ALPHABET.length;
    result += ALPHABET[idx2] ?? ALPHABET.charAt(0);
  }
  return result;
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export { ALPHABET, BODY_LENGTH, CHECKSUM_LENGTH };
