import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { LoyaltyError } from "../lib/errors.js";

// Admin routes that are reachable without an established admin session.
// `/admin/me` self-checks `request.adminId` and returns 401 on its own.
const ADMIN_PUBLIC_PATHS = new Set([
  "/api/v1/admin/login",
  "/api/v1/admin/logout",
  "/api/v1/admin/me",
]);

// eslint-disable-next-line @typescript-eslint/require-await
async function adminSessionGuardImpl(app: FastifyInstance): Promise<void> {
  // Deny-by-default: every /api/v1/admin/* route (except the three above)
  // requires an authenticated admin session. API keys — including SERVER-scope
  // internal keys — do NOT grant admin access.
  app.addHook("preHandler", (request, _reply, done) => {
    const path = request.url.split("?")[0] ?? "";

    if (!path.startsWith("/api/v1/admin/")) {
      done();
      return;
    }
    if (ADMIN_PUBLIC_PATHS.has(path)) {
      done();
      return;
    }
    if (request.adminId == null) {
      throw new LoyaltyError("FORBIDDEN", 403);
    }
    done();
  });
}

export const adminSessionGuard = fp(adminSessionGuardImpl, { name: "admin-session-guard" });
export default adminSessionGuard;
