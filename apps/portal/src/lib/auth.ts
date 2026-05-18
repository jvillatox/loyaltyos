import { fetchApi, postApi } from "./api-client";

interface AuthSession {
  token: string;
  memberId: string;
  programId: string;
}

export function getSession(): AuthSession | null {
  const token = sessionStorage.getItem("auth-token");
  const memberId = sessionStorage.getItem("member-id");
  const programId = sessionStorage.getItem("program-id");
  if (token && memberId && programId) {
    return { token, memberId, programId };
  }
  return null;
}

export function setSession(session: AuthSession): void {
  sessionStorage.setItem("auth-token", session.token);
  sessionStorage.setItem("member-id", session.memberId);
  sessionStorage.setItem("program-id", session.programId);
}

export function clearSession(): void {
  sessionStorage.removeItem("auth-token");
  sessionStorage.removeItem("member-id");
  sessionStorage.removeItem("program-id");
}

export function isAuthenticated(): boolean {
  return sessionStorage.getItem("member-id") !== null;
}

export async function sendMagicLink(email: string, locale = "en"): Promise<void> {
  await postApi("/auth/magic-link", { email, locale });
}

export async function verifyMagicLink(token: string): Promise<AuthSession> {
  const result = await postApi<{
    sessionId: string;
    expiresAt: string;
    member: {
      id: string;
      email: string | null;
      phone: string | null;
      firstName: string | null;
      lastName: string | null;
      programId: string;
      joinedAt: string;
    };
  }>("/auth/verify-magic-link", { token });
  const session = {
    token: result.sessionId,
    memberId: result.member.id,
    programId: result.member.programId,
  };
  setSession(session);
  return session;
}

export async function loginWithOtp(email: string, otp: string): Promise<AuthSession> {
  const result = await postApi<AuthSession>("/auth/otp", { email, otp });
  setSession(result);
  return result;
}

export async function getProfile() {
  return fetchApi<{
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    joinedAt: string;
  }>("/members/me");
}
