import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = join(import.meta.dirname, "..", "src", "locales");
const TYPES_PATH = join(import.meta.dirname, "..", "src", "types.ts");

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
  const esMxPath = join(LOCALES_DIR, "es-MX.json");
  const esMx = JSON.parse(readFileSync(esMxPath, "utf-8")) as NestedJson;

  const content = `import esMX from "./locales/es-MX.json" with { type: "json" };

type JsonShape = typeof esMX;

type DotPrefix<T extends string, K extends string> = K extends ""
  ? T
  : \`\${T}.\${K}\`;

type NestedKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? NestedKeys<T[K], DotPrefix<Prefix, K>>
    : DotPrefix<Prefix, K>;
}[keyof T & string];

/** All valid translation keys derived from es-MX.json */
export type TranslationKey = NestedKeys<JsonShape>;

/** Type-safe t() function signature */
export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;
`;

  writeFileSync(TYPES_PATH, content, "utf-8");
  console.log(`✅ Generated types with ${String(getAllKeys(esMx).length)} keys`);
}

main();
