import { pick } from "accept-language-parser";

const SUPPORTED_LOCALES = ["es-MX", "en-US"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "es-MX";

const SUPPORTED_READONLY: readonly string[] = SUPPORTED_LOCALES;

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

export function getSupportedLocales(): readonly string[] {
  return SUPPORTED_LOCALES;
}

export function resolveLocale(input: {
  acceptLanguage?: string;
  browserLanguage?: string;
  userPreference?: string;
  programDefault?: string;
}): SupportedLocale {
  // 1. User preference (explicit choice) — highest priority
  if (input.userPreference && isSupportedLocale(input.userPreference)) {
    return input.userPreference;
  }

  // 2. Browser language — try exact match then closest via accept-language-parser
  if (input.browserLanguage) {
    const picked = pick(SUPPORTED_READONLY, input.browserLanguage);
    if (picked) return picked as SupportedLocale;
  }

  // 3. Accept-Language header — properly handles q= weights and region matching
  if (input.acceptLanguage) {
    const picked = pick(SUPPORTED_READONLY, input.acceptLanguage);
    if (picked) return picked as SupportedLocale;
  }

  // 4. Program default
  if (input.programDefault && isSupportedLocale(input.programDefault)) {
    return input.programDefault;
  }

  // 5. Hard fallback
  return DEFAULT_LOCALE;
}
