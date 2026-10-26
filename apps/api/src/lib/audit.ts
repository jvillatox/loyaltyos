import type { AuditAction, AuditActorType } from "@prisma/client";

import { prisma } from "../db.js";

export interface AuditActor {
  type: AuditActorType;
  id: string;
  /** Set when the actor is a personal access token; recorded as metadata.patId. */
  patId?: string;
}

export async function audit(
  programId: string,
  actor: AuditActor,
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  diff: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const metadataWithPat = actor.patId ? { patId: actor.patId, ...metadata } : metadata;
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
      metadata: metadataWithPat as never,
    },
  });
}
