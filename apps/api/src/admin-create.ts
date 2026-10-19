import { hashPassword } from "@loyaltyos/core";
import { isAdminRole } from "@loyaltyos/permissions";
import { PrismaClient } from "@prisma/client";

/**
 * Create an admin user from the command line.
 *
 *   pnpm --filter @loyaltyos/api admin:create \
 *     --email operator@loyaltyos.dev --role OPERATOR --program prog_dev
 *
 * The password is read from stdin (never passed as an argument, so it does not
 * appear in shell history or the process list).
 */

interface Options {
  email: string;
  role: string;
  programId: string;
  name?: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { email: "", role: "", programId: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--email" && next) {
      opts.email = next;
      i++;
    } else if (arg === "--role" && next) {
      opts.role = next;
      i++;
    } else if (arg === "--program" && next) {
      opts.programId = next;
      i++;
    } else if (arg === "--name" && next) {
      opts.name = next;
      i++;
    }
  }
  return opts;
}

function readPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    const isTTY = Boolean(process.stdin.isTTY);
    if (isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 3) {
          // Ctrl+C
          cleanup();
          process.stdout.write("\n");
          reject(new Error("aborted"));
          return;
        }
        if (code === 13 || code === 10) {
          // Enter
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (code === 127 || code === 8) {
          // Backspace
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    const cleanup = () => {
      process.stdin.off("data", onData);
      if (isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    };
    process.stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.email) {
    console.error("Missing required --email");
    process.exit(1);
  }
  if (!isAdminRole(opts.role)) {
    console.error(`Invalid --role "${opts.role}". Expected SUPER_ADMIN, OPERATOR, or ANALYST.`);
    process.exit(1);
  }
  if (!opts.programId) {
    console.error("Missing required --program");
    process.exit(1);
  }

  const password = await readPassword(`Password for ${opts.email}: `);
  if (password.length < 8) {
    console.error("Password must be at least 8 characters");
    process.exit(1);
  }

  const prisma = new PrismaClient({ log: ["warn", "error"] });
  try {
    const admin = await prisma.adminUser.create({
      data: {
        email: opts.email.toLowerCase(),
        name: opts.name ?? opts.email,
        role: opts.role,
        passwordHash: await hashPassword(password),
        programId: opts.programId,
      },
    });
    console.log(`Created admin ${admin.email} (${admin.role}) in program ${admin.programId}`);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("Unique constraint failed") || message.includes("P2002")) {
      console.error(`An admin with email ${opts.email} already exists.`);
    } else {
      console.error("Failed to create admin:", message);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
