import { verifyPassword } from "@loyaltyos/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { adminLucia } from "../../lib/auth/admin-lucia.js";

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export function adminAuthRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  /** POST /admin/login — authenticate an admin user */
  app.post(
    "/admin/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);

      const admin = await prisma.adminUser.findFirst({
        where: { email: body.email, isActive: true },
      });

      // Always run argon2 to equalize timing (prevents email enumeration)
      const dummyHash =
        "$argon2id$v=19$m=19456,t=2,p=1$xxxxxxxxxxxxxxxxxxxxxx$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      const valid = await verifyPassword(admin?.passwordHash ?? dummyHash, body.password);

      if (!admin || !valid) {
        return reply.status(401).send({
          error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
        });
      }

      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date() },
      });

      const session = await adminLucia.createSession(admin.id, {});
      const cookie = adminLucia.createSessionCookie(session.id);
      void reply.header("Set-Cookie", cookie.serialize());

      return reply.send({
        data: {
          admin: {
            id: admin.id,
            email: admin.email,
            name: admin.name,
            role: admin.role,
          },
        },
      });
    },
  );

  /** POST /admin/logout — invalidate admin session */
  app.post("/admin/logout", async (request, reply) => {
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const sessionId = adminLucia.readSessionCookie(cookieHeader);
      if (sessionId) {
        await adminLucia.invalidateSession(sessionId);
      }
    }

    const blankCookie = adminLucia.createBlankSessionCookie();
    void reply.header("Set-Cookie", blankCookie.serialize());
    return reply.send({ ok: true });
  });

  done();
}
