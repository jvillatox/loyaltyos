import { PrismaAdapter } from "@lucia-auth/adapter-prisma";
import { Lucia, TimeSpan } from "lucia";

import { prisma } from "../../db.js";

const adapter = new PrismaAdapter(prisma.adminSession, prisma.adminUser);

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
    role: dbUser.role,
    programId: dbUser.programId,
  }),
});

declare module "lucia" {
  interface Register {
    AdminLucia: typeof adminLucia;
  }
}
