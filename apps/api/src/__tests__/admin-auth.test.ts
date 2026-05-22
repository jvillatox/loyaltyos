import { hashPassword } from "@loyaltyos/core";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

let app: FastifyInstance;
let prisma: PrismaClient;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;
});

afterAll(async () => {
  await app.close();
});

describe("POST /admin/login", () => {
  it("returns 401 with invalid credentials for unknown email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/login",
      payload: { email: "noone@test.com", password: "test" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 401 with wrong password", async () => {
    const pwd = await hashPassword("real-password");
    // Create a test admin user for this test case only
    const admin = await prisma.adminUser.create({
      data: {
        email: "wrongpwd-test@loyaltyos.dev",
        name: "Test",
        passwordHash: pwd,
        role: "OPERATOR",
        programId: "prog_dev",
      },
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        payload: { email: "wrongpwd-test@loyaltyos.dev", password: "wrong" },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await prisma.adminUser.delete({ where: { id: admin.id } }).catch(() => {});
    }
  });

  it("successfully logs in with correct credentials", async () => {
    const pwd = await hashPassword("correct-password");
    const admin = await prisma.adminUser.create({
      data: {
        email: "login-test@loyaltyos.dev",
        name: "Test Login",
        passwordHash: pwd,
        role: "OPERATOR",
        programId: "prog_dev",
      },
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        payload: { email: "login-test@loyaltyos.dev", password: "correct-password" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.admin.email).toBe("login-test@loyaltyos.dev");
      expect(body.data.admin.role).toBe("OPERATOR");

      // Check that Set-Cookie header is present
      const cookies = res.cookies;
      expect(cookies).toHaveLength(1);
      const sessionCookie = cookies[0];
      expect(sessionCookie?.name).toBe("loyaltyos_admin_session");
      expect(sessionCookie?.httpOnly).toBe(true);
    } finally {
      await prisma.adminUser.delete({ where: { id: admin.id } }).catch(() => {});
    }
  });
});

describe("POST /admin/logout", () => {
  it("returns 200 even without a session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/logout",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("clears the cookie when logged in", async () => {
    const pwd = await hashPassword("logout-test");
    const admin = await prisma.adminUser.create({
      data: {
        email: "logout-test@loyaltyos.dev",
        name: "Logout Test",
        passwordHash: pwd,
        role: "OPERATOR",
        programId: "prog_dev",
      },
    });

    try {
      // First login
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        payload: { email: "logout-test@loyaltyos.dev", password: "logout-test" },
      });
      const loginCookies = loginRes.cookies;
      const sessionCookie = loginCookies.find((c) => c.name === "loyaltyos_admin_session");

      // Then logout with the session cookie
      const logoutRes = await app.inject({
        method: "POST",
        url: "/api/v1/admin/logout",
        headers: sessionCookie
          ? { cookie: `${sessionCookie.name}=${sessionCookie.value}` }
          : undefined,
      });
      expect(logoutRes.statusCode).toBe(200);

      // The blank cookie should expire immediately
      const blankCookies = logoutRes.cookies;
      const blank = blankCookies.find((c) => c.name === "loyaltyos_admin_session");
      expect(blank).toBeDefined();
    } finally {
      await prisma.adminUser.delete({ where: { id: admin.id } }).catch(() => {});
    }
  });
});

describe("Admin auth rate limiting", () => {
  it("rate-limits login to 5 requests per minute", async () => {
    let hit429 = false;
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        payload: { email: `ratelimit-${i}@test.com`, password: "wrong" },
      });

      if (res.statusCode === 429) {
        hit429 = true;
        break;
      }
      expect(res.statusCode).toBe(401);
    }
    expect(hit429).toBe(true);
  });
});
