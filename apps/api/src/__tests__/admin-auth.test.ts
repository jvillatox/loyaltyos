import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { createTestAdmin, deleteTestAdmin } from "./helpers/test-admin.js";

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
    const email = "wrongpwd-test@loyaltyos.dev";
    await createTestAdmin(prisma, {
      email,
      name: "Test",
      password: "real-password",
      role: "OPERATOR",
      programId: "prog_dev",
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        payload: { email, password: "wrong" },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });

  it("successfully logs in with correct credentials", async () => {
    const email = "login-test@loyaltyos.dev";
    await createTestAdmin(prisma, {
      email,
      name: "Test Login",
      password: "correct-password",
      role: "OPERATOR",
      programId: "prog_dev",
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        payload: { email, password: "correct-password" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.admin.email).toBe(email);
      expect(body.data.admin.role).toBe("OPERATOR");

      // Check that Set-Cookie header is present
      const cookies = res.cookies;
      expect(cookies).toHaveLength(1);
      const sessionCookie = cookies[0];
      expect(sessionCookie?.name).toBe("loyaltyos_admin_session");
      expect(sessionCookie?.httpOnly).toBe(true);
    } finally {
      await deleteTestAdmin(prisma, email);
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
    const email = "logout-test@loyaltyos.dev";
    await createTestAdmin(prisma, {
      email,
      name: "Logout Test",
      password: "logout-test",
      role: "OPERATOR",
      programId: "prog_dev",
    });

    try {
      // First login
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        payload: { email, password: "logout-test" },
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
      await deleteTestAdmin(prisma, email);
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
