import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { LoyaltyError } from "../lib/errors.js";
import { type Principal, routePolicy } from "../lib/route-policy.js";

// Runs after the auth plugin (which resolves the principal) and before the
// admin-rbac plugin. Enforces deny-by-default on non-/admin, non-auth routes.
// Admin routes are left to admin-session-guard + admin-rbac; the auth plugin
// already gates public routes.

function resolvePrincipal(request: FastifyRequest): Principal | null {
  // An authenticated admin (session or PAT) is identified by adminId; its
  // effective role is adminRole, which is null when the stored role is missing
  // or not a recognized role. Such a session must be denied, not treated as
  // SERVER — there is no principal fallback.
  if (request.adminId != null) {
    return request.adminRole;
  }

  // API key (or member session, which the auth plugin marks scope "MEMBER").
  switch (request.apiKeyScope) {
    case "SERVER":
    case "CLIENT":
    case "MEMBER":
      return request.apiKeyScope;
    default:
      return null; // unknown scope → deny
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function routePolicyImpl(_app: FastifyInstance): Promise<void> {
  // Callback-style hook (request, reply, done): Fastify only auto-advances an
  // async hook; a sync hook must invoke `done` to continue the pipeline.
  _app.addHook("preHandler", (request, _reply, done) => {
    const path: string | undefined = request.routeOptions.url;
    if (!path) {
      done();
      return;
    }
    if (!path.startsWith("/api/v1/")) {
      done();
      return;
    }
    if (path.startsWith("/api/v1/admin/")) {
      done();
      return;
    }
    if (path.startsWith("/api/v1/auth/")) {
      done();
      return;
    }

    // Read-only member session tokens may not mutate, regardless of what the
    // route policy otherwise allows for the MEMBER principal.
    if (request.memberTokenReadOnly && request.method !== "GET" && request.method !== "HEAD") {
      done(new LoyaltyError("FORBIDDEN", 403));
      return;
    }

    const allowed = routePolicy(request.method, path);
    const principal = resolvePrincipal(request);

    if (principal != null && allowed.includes(principal)) {
      done();
      return;
    }

    if (principal === "MEMBER" && allowed.includes("SELF")) {
      const id = (request.params as { id?: string } | undefined)?.id;
      if (id === request.memberId) {
        done();
        return;
      }
    }

    done(new LoyaltyError("FORBIDDEN", 403));
  });
}

export const routePolicyPlugin = fp(routePolicyImpl, { name: "route-policy" });
export default routePolicyPlugin;
