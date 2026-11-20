import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type CoalitionAdapter,
  CoalitionService,
  createApprecioAdapter,
  type IdentifierType,
} from "@loyaltyos/coalition";
import { PrismaClient } from "@prisma/client";

/**
 * Local smoke-test for coalition reconciliation against Apprecio staging.
 *
 * Credentials are read from `.env.staging` (gitignored — never commit tokens)
 * and are NOT wired into CI. Run manually from the API package:
 *
 *   pnpm --filter @loyaltyos/api coalition:reconcile:staging healthcheck
 *   pnpm --filter @loyaltyos/api coalition:reconcile:staging history --ref user@example.com
 *   pnpm --filter @loyaltyos/api coalition:reconcile:staging sweep
 *   pnpm --filter @loyaltyos/api coalition:reconcile:staging reconcile --tx <id> --force
 *
 * Required `.env.staging` variables:
 *   APPRECIO_API_BASE          https staging base URL (must be https://)
 *   APPRECIO_PUBLIC_TOKEN      merchant public token
 *   APPRECIO_PRIVATE_TOKEN     merchant private secret (never logged)
 *   APPRECIO_IDENTIFIER_TYPE   "email" | "rut" (default "email")
 *   APPRECIO_TIMEOUT_MS        optional, default 10000
 *   DATABASE_URL               required only for sweep/reconcile
 *
 * `healthcheck` and `history` exercise the adapter directly with the env tokens,
 * so they need no database and are useful for capturing real staging responses
 * (e.g. the exact duplicate-ts JSON shape, to tighten `isDuplicateTsResponse`).
 * `sweep` and `reconcile` go through CoalitionService, which resolves each
 * program's adapter from its CoalitionConfig (or the legacy env fallback).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(__dirname, "..", ".env.staging");

type Command = "help" | "healthcheck" | "history" | "sweep" | "reconcile";

interface Options {
  command: Command;
  ref?: string;
  from?: string;
  to?: string;
  tx?: string;
  force: boolean;
}

const USAGE = `
Usage: coalition-reconcile-staging <command> [options]

Commands:
  healthcheck                        Verify Apprecio staging connectivity + auth.
  history --ref <externalMemberRef>  Query historialCarga and print entries.
                                     [--from YYYY-MM-DD] [--to YYYY-MM-DD]
  sweep                              Reconcile every PENDING tx older than 5 min.
  reconcile --tx <id> [--force]      Reconcile a single transaction.
                                     --force retries NEEDS_REVIEW too.

Examples:
  pnpm --filter @loyaltyos/api coalition:reconcile:staging healthcheck
  pnpm --filter @loyaltyos/api coalition:reconcile:staging history --ref user@example.com
  pnpm --filter @loyaltyos/api coalition:reconcile:staging sweep
  pnpm --filter @loyaltyos/api coalition:reconcile:staging reconcile --tx abc123 --force
`;

function printUsage(): void {
  console.log(USAGE);
}

/** Minimal .env loader (no dependencies). Does not override already-set env vars. */
function loadEnvFile(filePath: string): void {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    console.error(
      `Missing ${filePath}. Create it locally (gitignored) from your staging credentials — never commit tokens.`,
    );
    process.exit(1);
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { command: "help", force: false };
  if (argv.length === 0) return opts;

  const first = argv[0];
  if (first === "healthcheck") opts.command = "healthcheck";
  else if (first === "history") opts.command = "history";
  else if (first === "sweep") opts.command = "sweep";
  else if (first === "reconcile") opts.command = "reconcile";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--ref" && next) {
      opts.ref = next;
      i++;
    } else if (arg === "--from" && next) {
      opts.from = next;
      i++;
    } else if (arg === "--to" && next) {
      opts.to = next;
      i++;
    } else if (arg === "--tx" && next) {
      opts.tx = next;
      i++;
    } else if (arg === "--force") {
      opts.force = true;
    }
  }
  return opts;
}

interface ApprecioEnv {
  apiBase: string;
  publicToken: string;
  privateToken: string;
  identifierType: IdentifierType;
  timeoutMs: number;
}

function readApprecioConfig(): ApprecioEnv {
  const apiBase = process.env.APPRECIO_API_BASE;
  const publicToken = process.env.APPRECIO_PUBLIC_TOKEN;
  const privateToken = process.env.APPRECIO_PRIVATE_TOKEN;
  const identifierType = process.env.APPRECIO_IDENTIFIER_TYPE ?? "email";
  const timeoutMs = Number(process.env.APPRECIO_TIMEOUT_MS ?? 10000);

  if (!apiBase || !publicToken || !privateToken) {
    console.error(
      "Missing Apprecio credentials. Set APPRECIO_API_BASE, APPRECIO_PUBLIC_TOKEN and " +
        "APPRECIO_PRIVATE_TOKEN in .env.staging.",
    );
    process.exit(1);
  }
  if (identifierType !== "email" && identifierType !== "rut") {
    console.error(
      `Invalid APPRECIO_IDENTIFIER_TYPE "${identifierType}" (expected "email" or "rut").`,
    );
    process.exit(1);
  }

  return { apiBase, publicToken, privateToken, identifierType, timeoutMs };
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    console.error(`Invalid date "${value}" (expected YYYY-MM-DD).`);
    process.exit(1);
  }
  return date;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function main(): Promise<void> {
  loadEnvFile(ENV_FILE);
  const opts = parseArgs(process.argv.slice(2));

  if (opts.command === "help") {
    printUsage();
    return;
  }

  const { apiBase, publicToken, privateToken, identifierType, timeoutMs } = readApprecioConfig();
  const adapter: CoalitionAdapter = createApprecioAdapter({
    apiBase,
    publicToken,
    privateToken,
    identifierType,
    timeoutMs,
  });

  if (opts.command === "healthcheck") {
    const result = await adapter.healthcheck();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (opts.command === "history") {
    if (!opts.ref) {
      console.error("history requires --ref <externalMemberRef>");
      process.exit(1);
    }
    if (!adapter.queryHistory) {
      console.error("The Apprecio adapter does not support history queries");
      process.exit(1);
    }
    const from = parseDate(opts.from, daysAgo(30));
    const to = parseDate(opts.to, new Date());
    const entries = await adapter.queryHistory(opts.ref, from, to);
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  // sweep and reconcile need the database.
  const prisma = new PrismaClient({ log: ["warn", "error"] });
  try {
    const service = new CoalitionService(prisma);
    service.registerAdapter(adapter);

    if (opts.command === "sweep") {
      const summary = await service.runReconciliationSweep();
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    if (!opts.tx) {
      console.error("reconcile requires --tx <id>");
      process.exit(1);
    }
    const outcome = await service.reconcilePendingTransaction(opts.tx, {
      force: opts.force,
    });
    console.log(JSON.stringify({ txId: opts.tx, outcome }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
