import { PrismaAdapter } from "@lucia-auth/adapter-prisma";
import { Lucia, TimeSpan } from "lucia";

import { prisma } from "../../db.js";

// Admin auth reads the tenancy identity root (docs/design/tenancy.md §1.2):
// sessions belong to a `User`, and the session carries the active org/program
// *selection* (not the role — role is read fresh from the membership on every
// request). The PrismaAdapter persists `DatabaseSessionAttributes` as extra
// columns on `AdminSession`.
const adapter = new PrismaAdapter(prisma.adminSession, prisma.user);

export const adminLucia = new Lucia(adapter, {
  sessionExpiresIn: new TimeSpan(8, "h"),
  sessionCookie: {
    name: "loyaltyos_admin_session",
    attributes: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  },
  getUserAttributes: (dbUser) => ({
    email: dbUser.email,
    name: dbUser.name,
    locale: dbUser.locale,
    status: dbUser.status,
  }),
  getSessionAttributes: (dbSession) => ({
    activeOrganizationId: dbSession.activeOrganizationId ?? null,
    activeProgramId: dbSession.activeProgramId ?? null,
  }),
});

declare module "lucia" {
  interface Register {
    AdminLucia: typeof adminLucia;
    DatabaseSessionAttributes: {
      activeOrganizationId?: string | null;
      activeProgramId?: string | null;
    };
  }
}

export type AdminAuthMode = "user" | "legacy";

// TENANCY_ADMIN_AUTH selects which identity root login + session resolution
// reads (docs/design/tenancy.md §7). Default `user`; `legacy` restores the
// AdminUser-backed flow for the rollback window.
export function adminAuthMode(): AdminAuthMode {
  return process.env.TENANCY_ADMIN_AUTH === "legacy" ? "legacy" : "user";
}
