import type { preHandlerHookHandler } from "fastify";

import { LoyaltyError } from "../lib/errors.js";

export const requireAdmin: preHandlerHookHandler = (request) => {
  const hasAdminSession = request.adminId != null;
  const hasServerScope = request.apiKeyScope === "SERVER";

  if (!hasAdminSession && !hasServerScope) {
    throw new LoyaltyError("FORBIDDEN", 403);
  }
};
