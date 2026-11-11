import { generateOpaqueToken } from "./personal-access-token.js";

export const MEMBER_TOKEN_PREFIX = "lomem_";
export const MEMBER_TOKEN_BYTES = 32;
export const MEMBER_TOKEN_DEFAULT_TTL_SECONDS = 900;
export const MEMBER_TOKEN_MAX_TTL_SECONDS = 3600;

/**
 * Generate a member session token. The plaintext token is returned exactly once;
 * only its SHA-256 hash is ever persisted.
 */
export function generateMemberToken(): { token: string; tokenHash: string } {
  const { token, tokenHash } = generateOpaqueToken(MEMBER_TOKEN_PREFIX, MEMBER_TOKEN_BYTES);
  return { token, tokenHash };
}
