import { hashPassword } from "@loyaltyos/core";
import type {
  AdminRole,
  AdminUser,
  OrganizationMembership,
  PrismaClient,
  User,
} from "@prisma/client";

import { createAdminUser } from "../../admin-create.js";
import { DEFAULT_ORG_ID } from "../../lib/tenancy-users.js";

// Shared test fixture for PR 7: admin identity now lives on the tenancy `User` +
// `OrganizationMembership` (with `AdminUser` as the reverse mirror). Tests that
// need to log in as an admin must produce the full identity, not just an
// `AdminUser` row — `POST /admin/login` in `user` mode reads `User.passwordHash`
// and the active membership.

export interface TestAdmin {
  admin: AdminUser;
  user: User;
  membership: OrganizationMembership;
  password: string;
}

export async function createTestAdmin(
  prisma: PrismaClient,
  input: {
    email: string;
    password: string;
    role: AdminRole;
    programId: string;
    name?: string;
  },
): Promise<TestAdmin> {
  const passwordHash = await hashPassword(input.password);
  const admin = await createAdminUser(prisma, {
    email: input.email,
    name: input.name ?? input.email,
    role: input.role,
    programId: input.programId,
    passwordHash,
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { email: input.email } });
  const membership = await prisma.organizationMembership.findUniqueOrThrow({
    where: { userId_organizationId: { userId: user.id, organizationId: DEFAULT_ORG_ID } },
  });
  return { admin, user, membership, password: input.password };
}

// Deletes the whole identity (User cascades membership + admin sessions; the
// AdminUser mirror is a separate row keyed by the same email).
export async function deleteTestAdmin(prisma: PrismaClient, email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.organizationMembership.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.adminSession.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  await prisma.adminUser.deleteMany({ where: { email } }).catch(() => {});
}
