import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 32-byte key from an arbitrary-length secret using SHA-256.
 *
 * In development, a hardcoded fallback key is used so the stack is zero-config.
 * In production, set KMS_MASTER_KEY in the environment to a strong secret.
 *
 * Migration path to AWS KMS / HashiCorp Vault:
 *   1. Store the master key in KMS/Vault instead of an env var.
 *   2. Replace `getMasterKey()` with a call to the KMS decrypt API.
 *   3. Rotate keys by decrypting existing credentials with the old key,
 *      then re-encrypting with the new key.
 */
function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

/** Minimum acceptable length for KMS_MASTER_KEY in production. */
export const MIN_MASTER_KEY_LENGTH = 32;

const DEV_FALLBACK_KEY = "loyaltyos-coalition-dev-key-2026";

/** Returns the master encryption key from the environment or a dev fallback. */
export function getMasterKey(): string {
  const envKey = process.env.KMS_MASTER_KEY;
  if (envKey && envKey.length >= MIN_MASTER_KEY_LENGTH) return envKey;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "KMS_MASTER_KEY is not configured for production: it must be at least " +
        `${String(MIN_MASTER_KEY_LENGTH)} characters. Set KMS_MASTER_KEY before starting. ` +
        "If credentials were encrypted with a previous key, run the coalition:reencrypt script to migrate them.",
    );
  }

  console.warn(
    "[Coalition] KMS_MASTER_KEY not set — using development fallback. " +
      "Set KMS_MASTER_KEY to a strong secret in production.",
  );
  return DEV_FALLBACK_KEY;
}

/** Encrypts a plaintext string with AES-256-GCM. Returns a base64-encoded ciphertext. */
export function encrypt(plaintext: string, masterKey: string): string {
  const key = deriveKey(masterKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  // Concatenate iv + authTag + ciphertext, then base64-encode
  const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, "hex")]);
  return combined.toString("base64");
}

/** Decrypts a base64-encoded ciphertext produced by `encrypt()`. */
export function decrypt(encrypted: string, masterKey: string): string {
  const key = deriveKey(masterKey);
  const combined = Buffer.from(encrypted, "base64");

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext.toString("hex"), "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
