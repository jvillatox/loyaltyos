import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = join(import.meta.dirname, "..", "src", "locales");

interface NestedJson {
  [key: string]: string | NestedJson;
}

function getAllKeys(obj: NestedJson, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      keys.push(fullKey);
    } else {
      keys.push(...getAllKeys(value, fullKey));
    }
  }
  return keys;
}

function main(): void {
  const baseLocale = "es-MX";
  const basePath = join(LOCALES_DIR, `${baseLocale}.json`);
  const baseKeys = getAllKeys(JSON.parse(readFileSync(basePath, "utf-8")) as NestedJson).sort();

  const otherLocales = readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith(".json") && f !== `${baseLocale}.json`)
    .map((f) => f.replace(".json", ""));

  let hasErrors = false;

  for (const locale of otherLocales) {
    const path = join(LOCALES_DIR, `${locale}.json`);
    const localeKeys = getAllKeys(JSON.parse(readFileSync(path, "utf-8")) as NestedJson).sort();

    const missing = baseKeys.filter((k) => !localeKeys.includes(k));
    const extra = localeKeys.filter((k) => !baseKeys.includes(k));

    if (missing.length > 0) {
      hasErrors = true;
      console.error(`❌ ${locale} is missing keys:`);
      missing.forEach((k) => {
        console.error(`   - ${k}`);
      });
    }

    if (extra.length > 0) {
      hasErrors = true;
      console.error(`❌ ${locale} has extra keys not in ${baseLocale}:`);
      extra.forEach((k) => {
        console.error(`   - ${k}`);
      });
    }

    if (missing.length === 0 && extra.length === 0) {
      console.log(`✅ ${locale} (${String(localeKeys.length)} keys) — parity OK`);
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log(`\n✅ All locales have the same ${String(baseKeys.length)} keys as ${baseLocale}`);
}

main();
