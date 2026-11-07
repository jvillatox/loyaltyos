import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { LoyaltyError } from "../lib/errors.js";
import { type Principal, routePolicy } from "../lib/route-policy.js";

// Runs after the auth plugin (which resolves the principal) and before the
// admin-rbac plugin. Enforces deny-by-default on non-/admin, non-auth routes.
// Admin routes are left to admin-session-guard + admin-rbac; the auth plugin
// already gates public routes.

function resolvePrincipal(request: FastifyRequest): Principal {
  if (request.adminRole) return request.adminRole;
  if (request.apiKeyScope === "MEMBER") return "MEMBER";
  if (request.apiKeyScope === "CLIENT") return "CLIENT";
  return "SERVER";
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

    const allowed = routePolicy(request.method, path);
    const principal = resolvePrincipal(request);

    if (allowed.includes(principal)) {
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
