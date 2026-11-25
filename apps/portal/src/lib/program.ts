export interface LoyaltyOsConfig {
  programId?: string;
}

declare global {
  interface Window {
    __LOYALTYOS_CONFIG__?: LoyaltyOsConfig;
  }
}

// Resolves the program the portal should talk to before (and after) login.
// Priority:
//   1. sessionStorage "program-id" — set after a successful login, so an
//      authenticated session keeps using the member's actual program.
//   2. ?program= URL query param — lets one portal deployment serve several
//      programs via links.
//   3. window.__LOYALTYOS_CONFIG__.programId — /config.js, written at container
//      boot from PORTAL_PROGRAM_ID (no rebuild needed).
// Returns null when nothing is configured. Callers must surface a clear error
// instead of inventing a program id.
export function resolveProgramId(): string | null {
  const sessionProgramId = sessionStorage.getItem("program-id");
  if (sessionProgramId) return sessionProgramId;

  const urlProgram = new URLSearchParams(window.location.search).get("program");
  if (urlProgram) return urlProgram;

  return window.__LOYALTYOS_CONFIG__?.programId ?? null;
}
