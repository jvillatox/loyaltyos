export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}
