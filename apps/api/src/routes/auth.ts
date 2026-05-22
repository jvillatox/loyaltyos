import crypto from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { lucia } from "../lib/auth/lucia.js";
import { notificationsService } from "../lib/notifications-setup.js";

const TOKEN_MINUTES = 15;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

const magicLinkSchema = z.object({
  email: z.string().email().toLowerCase(),
  locale: z.string().optional(),
});

const verifySchema = z.object({
  token: z.string().min(1),
});

async function triggerMagicLinkEmail(
  memberId: string,
  programId: string,
  magicLinkUrl: string,
): Promise<void> {
  try {
    const member = await prisma.member.findFirst({
      where: { id: memberId },
      include: {
        pointAccount: true,
        memberTiers: { include: { tier: true } },
      },
    });

    const currentTier = member?.memberTiers.find((mt) => !mt.downgradedAt)?.tier.name;

    await notificationsService.sendTrigger(programId, "auth.magic_link", memberId, {
      magicLinkUrl,
      member: {
        id: member?.id,
        email: member?.email,
        phone: member?.phone,
        firstName: member?.firstName,
        lastName: member?.lastName,
        currentTier,
      },
    });
  } catch (err) {
    console.error("[Auth] Magic link notification failed:", err);
  }
}

function resolvePortalUrl(_programId: string): string {
  return process.env.PORTAL_URL ?? `http://localhost:5176`;
}

export function authRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  /** POST /auth/magic-link — request a sign-in link (always 200 OK) */
  app.post(
    "/auth/magic-link",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { email, locale: _locale } = magicLinkSchema.parse(request.body);

      const member = await prisma.member.findFirst({
        where: { email, deletedAt: null },
      });

      if (member) {
        const rawToken = generateToken();
        const tokenHash = hashToken(rawToken);

        await prisma.magicLinkToken.create({
          data: {
            memberId: member.id,
            tokenHash,
            expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60_000),
          },
        });

        const baseUrl = resolvePortalUrl(member.programId);
        const magicLinkUrl = `${baseUrl}/verify?token=${rawToken}`;

        // Fire and forget
        void triggerMagicLinkEmail(member.id, member.programId, magicLinkUrl);
      } else {
        // No-op for non-existent emails: prevent enumeration
        // Log for observability
        request.log.info({ email }, "Magic link requested for unknown email");
      }

      return reply.status(200).send({ ok: true });
    },
  );

  /** POST /auth/verify-magic-link — validate token, create session */
  app.post("/auth/verify-magic-link", async (request, reply) => {
    const { token } = verifySchema.parse(request.body);
    const tokenHash = hashToken(token);

    const record = await prisma.magicLinkToken.findFirst({
      where: {
        tokenHash,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { member: true },
    });

    if (!record) {
      return reply.status(401).send({
        error: { code: "INVALID_TOKEN", message: "Invalid or expired token" },
      });
    }

    // Atomic: mark as consumed
    await prisma.magicLinkToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const session = await lucia.createSession(record.memberId, {});

    const cookie = lucia.createSessionCookie(session.id);
    void reply.header("Set-Cookie", cookie.serialize());

    return reply.send({
      data: {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        member: {
          id: record.member.id,
          email: record.member.email,
          phone: record.member.phone,
          firstName: record.member.firstName,
          lastName: record.member.lastName,
          programId: record.member.programId,
          joinedAt: record.member.joinedAt,
        },
      },
    });
  });

  /** POST /auth/logout — invalidate current session */
  app.post("/auth/logout", async (request, reply) => {
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const sessionId = lucia.readSessionCookie(cookieHeader);
      if (sessionId) {
        await lucia.invalidateSession(sessionId);
      }
    }

    const blankCookie = lucia.createBlankSessionCookie();
    void reply.header("Set-Cookie", blankCookie.serialize());

    return reply.send({ ok: true });
  });

  /** GET /auth/me — return the currently authenticated member */
  app.get("/auth/me", async (request, reply) => {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "No session cookie" },
      });
    }

    const sessionId = lucia.readSessionCookie(cookieHeader);
    if (!sessionId) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Invalid session" },
      });
    }

    const { session, user } = await lucia.validateSession(sessionId);
    if (!user) {
      const blankCookie = lucia.createBlankSessionCookie();
      void reply.header("Set-Cookie", blankCookie.serialize());
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Session expired" },
      });
    }

    // Sliding expiration: refresh cookie if session is fresh (close to expiry)
    if (session.fresh) {
      const freshCookie = lucia.createSessionCookie(session.id);
      void reply.header("Set-Cookie", freshCookie.serialize());
    }

    const member = await prisma.member.findUnique({
      where: { id: user.id },
    });

    return reply.send({
      data: {
        id: member?.id,
        email: member?.email,
        phone: member?.phone,
        firstName: member?.firstName,
        lastName: member?.lastName,
        joinedAt: member?.joinedAt,
        programId: member?.programId,
      },
    });
  });

  done();
}
