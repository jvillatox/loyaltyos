import { PrismaAdapter } from "@lucia-auth/adapter-prisma";
import { Lucia, TimeSpan } from "lucia";

import { prisma } from "../../db.js";

const adapter = new PrismaAdapter(prisma.session, prisma.member);

export const lucia = new Lucia(adapter, {
  sessionExpiresIn: new TimeSpan(30, "d"),
  sessionCookie: {
    name: "loyaltyos_session",
    attributes: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      domain: process.env.COOKIE_DOMAIN ?? undefined,
    },
  },
  getUserAttributes: (dbUser) => ({
    email: dbUser.email,
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    programId: dbUser.programId,
  }),
});

declare module "lucia" {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: {
      // Member fields
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      // AdminUser fields
      name: string | null;
      role: string | null;
      programId: string;
    };
  }
}
