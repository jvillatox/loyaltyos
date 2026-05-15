import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";

declare module "fastify" {
  interface FastifyRequest {
    programId: string;
    apiKeyScope: string;
  }
}

function authPlugin(app: FastifyInstance): void {
  app.decorateRequest("programId", "");
  app.decorateRequest("apiKeyScope", "");

  app.addHook("onRequest", async (request) => {
    const apiKey = request.headers["x-api-key"] as string | undefined;
    const programId = request.headers["x-program-id"] as string | undefined;

    if (!apiKey) {
      throw Object.assign(new Error("Missing X-API-Key header"), { statusCode: 401 });
    }

    const key = await prisma.apiKey.findUnique({
      where: { key: apiKey },
    });

    if (!key?.isActive) {
      throw Object.assign(new Error("Invalid API key"), { statusCode: 401 });
    }

    if (key.expiresAt && key.expiresAt < new Date()) {
      throw Object.assign(new Error("API key has expired"), { statusCode: 401 });
    }

    // Update last used
    await prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    request.programId = programId ?? key.programId;
    request.apiKeyScope = key.scope;
  });
}

export { authPlugin };
