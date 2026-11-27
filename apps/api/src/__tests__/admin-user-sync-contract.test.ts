import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Contract guard for the reverse mirror (PR 7, docs/design/tenancy.md §7 row 7).
// Once auth reads the identity tables, every file that writes to `User` or
// `OrganizationMembership` must call syncTenancyUserToAdminUser so the AdminUser
// mirror cannot drift during the 2-release rollback window. `createAdminUser`
// (apps/api/src/admin-create.ts) is the sync-aware wrapper around the
// `user.create` + `organizationMembership.create` pair, so it also counts as a
// mirrored write path. A write that legitimately has no per-row mirror goes into
// EXEMPT_WRITES with a reason — do not add a blanket exemption.

const WRITE_METHOD_RE =
  /\b(?:user|organizationMembership)\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\b/g;
const RAW_SQL_RE = /"(?:User|OrganizationMembership)"/;
const SYNC_RE = /\b(?:syncTenancyUserToAdminUser|createAdminUser)\s*\(/;

// file-relative path + " :: " + write method → why syncing is not required.
const EXEMPT_WRITES: Record<string, string> = {
  "packages/tenancy/src/extension.ts :: rawSql":
    '"User"/"OrganizationMembership" are model names in GLOBAL_MODELS (tenant/global classification), not a raw SQL write',
};

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

describe("User tenancy-sync contract (reverse mirror)", () => {
  it("every User/OrganizationMembership write site is mirrored via syncTenancyUserToAdminUser", () => {
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
      if (RAW_SQL_RE.test(text)) {
        methods.add("rawSql");
      }
      if (methods.size === 0) {
        continue;
      }

      const hasSync = SYNC_RE.test(text);
      const violations = [...methods].filter(
        (method) => !hasSync && EXEMPT_WRITES[`${rel} :: ${method}`] === undefined,
      );
      if (violations.length > 0) {
        offenders.push(`${rel} (${violations.join(", ")})`);
      }
    }

    expect(
      offenders,
      [
        "User/OrganizationMembership writes found without a syncTenancyUserToAdminUser call:",
        ...offenders,
        "Add syncTenancyUserToAdminUser to the writing file, or list the write in EXEMPT_WRITES with a reason.",
      ].join("\n"),
    ).toEqual([]);
  });
});
