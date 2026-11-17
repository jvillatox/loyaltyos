export function resolvePortalUrl(_programId: string): string {
  return process.env.PORTAL_URL ?? "http://localhost:5176";
}
