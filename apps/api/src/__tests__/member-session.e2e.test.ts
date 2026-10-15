import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { AuditActor } from "../lib/audit.js";
import { audit } from "../lib/audit.js";

// Regression tests for issue #45 (magic-link login 500) plus the follow-up
// member-actor fix: the member session branch must report `MEMBER`, not
// `ADMIN_USER`, in the audit trail.
//
// These run against the real database (not mocks) because the magic-link 500
// only surfaces when the Prisma session model's relation name matches what the
// Lucia adapter derives (`member`, lowercased from `Member`). A mocked
// `session.findUnique` hides the schema mismatch.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = Date.now().toString();
const programId = `prog_member_${suffix}`;
const email = `member-${suffix}@loyaltyos.dev`;

let memberId: string;
let rawToken: string;

// Captured actors from requests passing through the auth plugin, keyed by URL.
const capturedActors: Array<{ url: string; actor: AuditActor }> = [];

beforeAll(async () => {
  app = await buildApp({ logger: false });

  // Runs after the auth plugin's preHandler, so `request.actor` reflects the
  // resolved session/API-key actor.
  app.addHook("preHandler", async (request) => {
    capturedActors.push({ url: request.url, actor: { ...request.actor } });
  });

  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({
    data: { id: programId, name: `Member Authz ${suffix}` },
  });

  const member = await prisma.member.create({
    data: { email, programId, firstName: "Carlos", lastName: "Mendoza" },
  });
  memberId = member.id;

  // Pre-create a magic-link token so verify-magic-link can resolve it.
  rawToken = createHash("sha256").update(`seed-${suffix}`).digest("hex");
  await prisma.magicLinkToken.create({
    data: {
      memberId,
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.magicLinkToken.deleteMany({ where: { memberId } }).catch(() => {});
  await prisma.session.deleteMany({ where: { userId: memberId } }).catch(() => {});
  await prisma.member.delete({ where: { id: memberId } }).catch(() => {});
  await prisma.program.delete({ where: { id: programId } }).catch(() => {});
  await app.close();
});

function sessionCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? (setCookie[0] ?? "") : (setCookie ?? "");
  return raw.split(";")[0] ?? "";
}

describe("magic-link login (issue #45)", () => {
  it("verify-magic-link → /auth/me returns the member without a 500", async () => {
    const verify = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-magic-link",
      payload: { token: rawToken },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().data.member.id).toBe(memberId);

    const cookie = sessionCookie(verify.headers["set-cookie"]);
    expect(cookie).toContain("loyaltyos_session");

    // /auth/me exercises lucia.validateSession → the Prisma adapter's
    // getSessionAndUser, which issues `include: { member: true }`. Before the
    // relation rename this threw (500).
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.email).toBe(email);

    // A member-facing route that relies on `request.memberId` must also work.
    const membersMe = await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { cookie },
    });
    expect(membersMe.statusCode).toBe(200);
    expect(membersMe.json().data.id).toBe(memberId);
  });
});

describe("member session actor is MEMBER", () => {
  it("records MEMBER (not ADMIN_USER) in the audit log", async () => {
    const verify = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-magic-link",
      payload: { token: rawToken },
    });
    const cookie = sessionCookie(verify.headers["set-cookie"]);

    await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { cookie },
    });

    const me = capturedActors.find((c) => c.url === "/api/v1/members/me");
    expect(me).toBeDefined();
    expect(me!.actor.type).toBe("MEMBER");
    expect(me!.actor.id).toBe(memberId);

    // The actor must persist to AuditLog as MEMBER with a null adminUserId.
    await audit(programId, me!.actor, "OTHER", "Member", memberId);
    const row = await prisma.auditLog.findFirst({
      where: { programId, entityId: memberId, entityType: "Member" },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row!.actorType).toBe("MEMBER");
    expect(row!.actorId).toBe(memberId);
    expect(row!.adminUserId).toBeNull();
  });
});
