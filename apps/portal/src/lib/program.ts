import { clearSession } from "./auth";

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
//   1. ?program= URL query param — lets one portal deployment serve several
//      programs via links, and lets a user switch programs explicitly.
//   2. sessionStorage "program-id" — set after a successful login, so an
//      authenticated session keeps using the member's actual program.
//   3. window.__LOYALTYOS_CONFIG__.programId — /config.js, written at container
//      boot from PORTAL_PROGRAM_ID (no rebuild needed).
// When the URL param names a program other than the one stored for the current
// session, the previous session is closed and the stored program is replaced.
// Returns null when nothing is configured. Callers must surface a clear error
// instead of inventing a program id.
export function resolveProgramId(): string | null {
  const urlProgram = new URLSearchParams(window.location.search).get("program");
  if (urlProgram) {
    const sessionProgramId = sessionStorage.getItem("program-id");
    if (sessionProgramId && sessionProgramId !== urlProgram) {
      clearSession();
      sessionStorage.setItem("program-id", urlProgram);
    }
    return urlProgram;
  }

  const sessionProgramId = sessionStorage.getItem("program-id");
  if (sessionProgramId) return sessionProgramId;

  return window.__LOYALTYOS_CONFIG__?.programId ?? null;
}
