import { decrypt, encrypt, getMasterKey } from "@loyaltyos/coalition";

import { prisma } from "./db.js";

/**
 * Re-encrypts every CoalitionConfig credential with the current master key.
 *
 *   pnpm --filter @loyaltyos/api coalition:reencrypt --from-key <old-key>
 *
 * The new key is read from KMS_MASTER_KEY (validated by `getMasterKey`). The old
 * key is passed explicitly so operators can migrate credentials that were written
 * with the development fallback (or any previous key). Secrets are never logged.
 */

function parseFromKey(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === "--from-key" && next) {
      return next;
    }
  }
  console.error("Usage: coalition-reencrypt --from-key <old-key>");
  process.exit(1);
}

async function main(): Promise<void> {
  const fromKey = parseFromKey(process.argv.slice(2));
  const toKey = getMasterKey();

  const configs = await prisma.coalitionConfig.findMany();

  let migrated = 0;
  let skipped = 0;

  for (const config of configs) {
    let plaintext: string;
    try {
      plaintext = decrypt(config.encryptedCredentials, fromKey);
    } catch {
      // Not decryptable with the provided old key — either already re-encrypted
      // or encrypted with a different key. Leave it untouched.
      skipped += 1;
      continue;
    }

    const reEncrypted = encrypt(plaintext, toKey);
    await prisma.coalitionConfig.update({
      where: { id: config.id },
      data: { encryptedCredentials: reEncrypted },
    });
    migrated += 1;
  }

  console.log(
    `Re-encrypted ${String(migrated)} coalition credential(s); skipped ${String(skipped)} that did not match the old key.`,
  );

  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error("Failed:", (error as Error).message);
  process.exit(1);
});
