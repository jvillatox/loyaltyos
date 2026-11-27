import { deriveOrganizationId } from "@loyaltyos/core";
import type { AuditAction, AuditActorType } from "@prisma/client";

import { prisma } from "../db.js";

export interface AuditActor {
  type: AuditActorType;
  // The identity that acted. For an admin session this is the tenancy `User.id`
  // (PR 7); for API keys, members, and the system it is their own id.
  id: string;
  /** Set when the actor is a personal access token; recorded as metadata.patId. */
  patId?: string;
  // Legacy AdminUser.id bridge. Only set for ADMIN_USER actors that have an
  // AdminUser mirror; the AuditLog.adminUserId FK (SetNull) references AdminUser,
  // so it is written from this field rather than `id` (which is now a User.id).
  adminUserId?: string | null;
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
  const organizationId = await deriveOrganizationId(prisma, programId);
  await prisma.auditLog.create({
    data: {
      programId,
      organizationId,
      actorType: actor.type,
      actorId: actor.id,
      adminUserId: actor.type === "ADMIN_USER" ? (actor.adminUserId ?? null) : null,
      action,
      entityType,
      entityId,
      diff: diff as never,
      metadata: metadataWithPat as never,
    },
  });
}
