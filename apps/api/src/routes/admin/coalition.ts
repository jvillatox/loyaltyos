import { encrypt, getMasterKey } from "@loyaltyos/coalition";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { coalitionService } from "../../lib/coalition-setup.js";

// ── Schemas ────────────────────────────────────────────────────────

const linkSchema = z.object({
  memberId: z.string().min(1),
  externalMemberRef: z.string().min(1),
});

const configSchema = z.object({
  provider: z.string().min(1).optional(),
  endpoint: z.string().min(1),
  credentials: z.record(z.string(), z.unknown()),
  conversionRate: z.number().positive().optional(),
  accumulationEnabled: z.boolean().optional(),
  redemptionEnabled: z.boolean().optional(),
  conversionEnabled: z.boolean().optional(),
  minConversionPoints: z.number().int().positive().optional(),
});

// ── Routes ─────────────────────────────────────────────────────────

export function adminCoalitionRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // ═══ Link Account ═══

  app.post("/admin/coalition/link", async (request, reply) => {
    const body = linkSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const account = await coalitionService.linkExternalAccount({
      memberId: body.memberId,
      programId,
      externalMemberRef: body.externalMemberRef,
    });

    return reply.status(201).send({ data: account });
  });

  // ═══ Unlink Account ═══

  app.delete("/admin/coalition/link/:memberId", async (request, reply) => {
    const { memberId } = z.object({ memberId: z.string() }).parse(request.params);
    const programId = request.programId || (request.headers["x-program-id"] as string);

    await coalitionService.unlinkExternalAccount(memberId, programId);

    return reply.status(204).send();
  });

  // ═══ List Linked Accounts ═══

  app.get("/admin/coalition/links", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const query = z
      .object({
        search: z.string().optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(request.query);

    const accounts = await coalitionService.listLinkedAccounts(programId, query);

    return reply.send({ data: accounts });
  });

  // ═══ Adapter Capabilities ═══

  app.get("/admin/coalition/capabilities", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const capabilities = await coalitionService.getAdapterCapabilities(programId);

    return reply.send({ data: capabilities });
  });

  // ═══ Transactions ═══

  app.get("/admin/coalition/transactions", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const query = z
      .object({
        status: z.string().optional(),
        memberId: z.string().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(request.query);

    const transactions = await coalitionService.listTransactions(programId, query);

    return reply.send({ data: transactions });
  });

  // ═══ Reconciliation ═══

  app.post("/admin/coalition/reconciliation", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);

    // Find pending/failed transactions for manual review
    const pending = await coalitionService.listTransactions(programId, {
      status: "PENDING",
      page: 1,
      pageSize: 50,
    });

    const failed = await coalitionService.listTransactions(programId, {
      status: "FAILED",
      page: 1,
      pageSize: 50,
    });

    const anomalies = [...pending, ...failed];

    return reply.send({
      data: {
        programId,
        anomalousCount: anomalies.length,
        anomalies,
        message:
          anomalies.length === 0
            ? "No anomalous transactions found"
            : `Found ${String(anomalies.length)} transactions that may need attention`,
      },
    });
  });

  // ═══ Config ═══

  app.get("/admin/coalition/config", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const config = await coalitionService.getConfig(programId);

    return reply.send({ data: config });
  });

  app.put("/admin/coalition/config", async (request, reply) => {
    const body = configSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const masterKey = getMasterKey();
    const encryptedCredentials = encrypt(JSON.stringify(body.credentials), masterKey);

    const config = await coalitionService.upsertConfig({
      programId,
      provider: body.provider,
      endpoint: body.endpoint,
      encryptedCredentials,
      conversionRate: body.conversionRate,
      accumulationEnabled: body.accumulationEnabled,
      redemptionEnabled: body.redemptionEnabled,
      conversionEnabled: body.conversionEnabled,
      minConversionPoints: body.minConversionPoints,
    });

    return reply.status(200).send({ data: config });
  });

  // ═══ Healthcheck ═══

  app.post("/admin/coalition/healthcheck", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const result = await coalitionService.healthcheck(programId);

    return reply.send({ data: result });
  });

  done();
}
