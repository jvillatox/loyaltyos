import { can } from "@loyaltyos/permissions";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { audit } from "../lib/audit.js";
import { LoyaltyError } from "../lib/errors.js";
import { ADMIN_SELF_SERVICE_PATHS, permissionForAdminRoute } from "../lib/permissions.js";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function logAccessDenied(
  app: FastifyInstance,
  request: FastifyRequest,
  path: string,
): Promise<void> {
  // Best-effort: the 403 must not depend on the audit write succeeding. Record
  // only the role, method and route — never the request body.
  try {
    await audit(request.programId, request.actor, "ACCESS_DENIED", "admin_route", null, {
      role: request.adminRole,
      method: request.method,
      path,
    });
  } catch (err) {
    app.log.warn({ err }, "Failed to record ACCESS_DENIED audit entry");
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function adminRbacImpl(app: FastifyInstance): Promise<void> {
  // Enforce role-based access after the auth plugin has resolved the admin
  // session and the admin-session guard has established deny-by-default for
  // `/admin/*`. Runs for admin sessions only; API keys and member sessions keep
  // their existing scope rules.
  app.addHook("preHandler", async (request) => {
    if (request.adminId == null) {
      return;
    }

    const path: string | undefined = request.routeOptions.url;
    if (!path) {
      return;
    }

    if (path.startsWith("/api/v1/admin/")) {
      // login/logout are public (no adminId) and `me` is any authenticated admin.
      if (ADMIN_SELF_SERVICE_PATHS.has(path)) {
        return;
      }

      const permission = permissionForAdminRoute(request.method, path);
      if (!permission || !can(request.adminRole, permission)) {
        await logAccessDenied(app, request, path);
        throw new LoyaltyError("FORBIDDEN", 403);
      }
      return;
    }

    // Non-admin routes (members, events, …) reached with an admin session: an
    // ANALYST may only read.
    if (request.adminRole === "ANALYST" && !READ_METHODS.has(request.method)) {
      await logAccessDenied(app, request, path);
      throw new LoyaltyError("FORBIDDEN", 403);
    }
  });
}

export const adminRbacPlugin = fp(adminRbacImpl, { name: "admin-rbac" });
export default adminRbacPlugin;
