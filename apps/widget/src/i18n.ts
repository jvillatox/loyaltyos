import { enUS, esMX } from "@loyaltyos/i18n/src/locales.js";

import type { WidgetLocale } from "./types.js";

const CATALOGS: Record<WidgetLocale, Record<string, unknown>> = {
  "es-MX": esMX as Record<string, unknown>,
  "en-US": enUS as Record<string, unknown>,
};

export function widgetT(
  key: string,
  params: Record<string, string | number> | undefined,
  locale: WidgetLocale,
): string {
  return resolveFromJson(CATALOGS[locale], key, params);
}

function resolveFromJson(
  obj: Record<string, unknown>,
  key: string,
  params?: Record<string, string | number>,
): string {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null || !(part in current)) {
      return key;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string") return key;

  if (params) {
    return current.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(params[k] ?? `{{${k}}}`));
  }
  return current;
}

export type { WidgetLocale };
