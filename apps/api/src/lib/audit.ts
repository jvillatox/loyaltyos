import type { AuditAction, AuditActorType } from "@prisma/client";

import { prisma } from "../db.js";

export interface AuditActor {
  type: AuditActorType;
  id: string;
}

export async function audit(
  programId: string,
  actor: AuditActor,
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  diff: Record<string, unknown> = {},
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      programId,
      actorType: actor.type,
      actorId: actor.id,
      adminUserId: actor.type === "ADMIN_USER" ? actor.id : null,
      action,
      entityType,
      entityId,
      diff: diff as never,
    },
  });
}
