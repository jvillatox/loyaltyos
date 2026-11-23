import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Contract guard for the tenancy expand phase (docs/design/tenancy.md §4 step 2).
// Every write to a §3.1 business table must derive `organizationId` — from its
// `programId`, or from a parent that carries one — so the composite FKs added in
// this PR (programId, organizationId) → Program(id, organizationId) stay consistent.
// A file that writes to a §3.1 model therefore must reference `organizationId`
// (directly, or via deriveOrganizationId / requireOrganizationId). `Program` is the
// root of the derivation chain and is exempt. The batch backfill
// (`backfillOrganizationColumns`, used by the seed and CLI) fills NULL
// `organizationId` en masse and also satisfies the contract.

// §3.1 tables except Program, in Prisma client (camelCase) accessor form.
const MODELS = [
  "member",
  "pointAccount",
  "pointTransaction",
  "pointLot",
  "pointExpiryReminder",
  "pointAdjustmentRequest",
  "pointRule",
  "tier",
  "memberTier",
  "campaign",
  "campaignVariant",
  "campaignApplication",
  "segment",
  "coupon",
  "couponRedemption",
  "giftCardBatch",
  "giftCard",
  "giftCardTransaction",
  "reward",
  "rewardRedemption",
  "badge",
  "memberBadge",
  "notificationTemplate",
  "notification",
  "coalitionConfig",
  "coalitionAccount",
  "coalitionTransaction",
  "webhookSubscription",
  "memberDevice",
  "memberNotificationPreferences",
  "termsTemplate",
  "event",
  "auditLog",
] as const;

// `\b` + the trailing `.` disambiguate prefix overlaps (member vs memberTier,
// campaign vs campaignApplication, etc.): the shorter alternative only matches when
// the next character is `.`, never the start of a longer accessor name.
const WRITE_METHOD_RE = new RegExp(
  `\\b(?:${MODELS.join("|")})\\.(create|createMany|upsert)\\b`,
  "g",
);

const DERIVATION_RE =
  /\b(organizationId|deriveOrganizationId|requireOrganizationId|backfillOrganizationColumns)\b/;

const EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "__tests__",
  "migrations",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".git",
  ".next",
  ".astro",
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..", "..");
const scannedRoots = [join(repoRoot, "apps"), join(repoRoot, "packages")];

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry)) {
        walk(full, out);
      }
    } else if (EXTENSIONS.has(extname(entry))) {
      out.push(full);
    }
  }
}

describe("§3.1 tenancy organizationId contract", () => {
  it("every §3.1 write site derives organizationId", () => {
    const files: string[] = [];
    for (const root of scannedRoots) {
      walk(root, files);
    }

    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const rel = relative(repoRoot, file);

      const methods = new Set<string>();
      for (const match of text.matchAll(WRITE_METHOD_RE)) {
        methods.add(match[1]);
      }
      if (methods.size === 0) {
        continue;
      }

      if (!DERIVATION_RE.test(text)) {
        offenders.push(`${rel} (${[...methods].join(", ")})`);
      }
    }

    expect(
      offenders,
      [
        "§3.1 model writes found without organizationId derivation:",
        ...offenders,
        "Derive organizationId in the writing file (via deriveOrganizationId /",
        "requireOrganizationId, or by backfilling with backfillOrganizationColumns).",
      ].join("\n"),
    ).toEqual([]);
  });
});
