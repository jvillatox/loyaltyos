import { adminRoleRank, isAdminRole } from "@loyaltyos/permissions";
import { PrismaClient } from "@prisma/client";

import { generateToken, MAX_TOKEN_DAYS } from "./lib/personal-access-token.js";

/**
 * Manage admin personal access tokens from the command line.
 *
 *   pnpm --filter @loyaltyos/api admin:token:create \
 *     --email operator@loyaltyos.dev --name "CI bot" --role ANALYST --days 30
 *   pnpm --filter @loyaltyos/api admin:token:list --email operator@loyaltyos.dev
 *   pnpm --filter @loyaltyos/api admin:token:revoke --id <token-id>
 *
 * The plaintext token is printed exactly once on create (never stored).
 */

interface Options {
  email?: string;
  name?: string;
  role?: string;
  days?: number;
  id?: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (!next) {
      continue;
    }
    if (arg === "--email") {
      opts.email = next;
      i++;
    } else if (arg === "--name") {
      opts.name = next;
      i++;
    } else if (arg === "--role") {
      opts.role = next;
      i++;
    } else if (arg === "--id") {
      opts.id = next;
      i++;
    } else if (arg === "--days") {
      opts.days = Number(next);
      i++;
    }
  }
  return opts;
}

function usage(): never {
  console.error(
    "Usage: admin-token <create|list|revoke> [--email <email>] [--name <name>] [--role <role>] [--days <n>] [--id <id>]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const opts = parseArgs(process.argv.slice(3));

  const prisma = new PrismaClient({ log: ["warn", "error"] });

  try {
    if (command === "create") {
      if (!opts.email || !opts.name || !opts.role) {
        usage();
      }
      if (!isAdminRole(opts.role)) {
        console.error(`Invalid --role "${opts.role}". Expected SUPER_ADMIN, OPERATOR, or ANALYST.`);
        process.exit(1);
      }
      const days = opts.days ?? 30;
      if (!Number.isInteger(days) || days < 1 || days > MAX_TOKEN_DAYS) {
        console.error(`--days must be an integer between 1 and ${String(MAX_TOKEN_DAYS)}.`);
        process.exit(1);
      }

      const admin = await prisma.adminUser.findUnique({
        where: { email: opts.email.toLowerCase() },
      });
      if (!admin) {
        console.error(`No admin found with email ${opts.email}.`);
        process.exit(1);
      }
      if (adminRoleRank(opts.role) > adminRoleRank(admin.role)) {
        console.error(
          `Role ${opts.role} exceeds the owner's role ${admin.role}. Token may not out-rank its owner.`,
        );
        process.exit(1);
      }

      const { token, tokenHash, prefix } = generateToken();
      const created = await prisma.personalAccessToken.create({
        data: {
          adminUserId: admin.id,
          name: opts.name,
          tokenHash,
          prefix,
          role: opts.role,
          expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        },
      });

      console.log(`Created token "${created.name}" (${created.role}) for ${admin.email}`);
      console.log(`Expires: ${created.expiresAt.toISOString()}`);
      console.log(`Token (copy now — it will not be shown again):`);
      console.log(token);
      return;
    }

    if (command === "list") {
      const tokens = opts.email
        ? await prisma.personalAccessToken.findMany({
            where: { adminUser: { email: opts.email.toLowerCase() } },
            orderBy: { createdAt: "desc" },
          })
        : await prisma.personalAccessToken.findMany({ orderBy: { createdAt: "desc" } });

      for (const t of tokens) {
        const state = t.revokedAt ? "revoked" : t.expiresAt < new Date() ? "expired" : "active";
        console.log(
          `${t.id}\t${t.prefix}…\t${t.role}\t${t.name}\t${state}\texpires ${t.expiresAt.toISOString()}`,
        );
      }
      return;
    }

    if (command === "revoke") {
      if (!opts.id) {
        usage();
      }
      const token = await prisma.personalAccessToken.findUnique({ where: { id: opts.id } });
      if (!token) {
        console.error(`No token found with id ${opts.id}.`);
        process.exit(1);
      }
      await prisma.personalAccessToken.update({
        where: { id: opts.id },
        data: { revokedAt: new Date() },
      });
      console.log(`Revoked token "${token.name}" (${token.id}).`);
      return;
    }

    usage();
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error("Failed:", (error as Error).message);
  process.exit(1);
});
