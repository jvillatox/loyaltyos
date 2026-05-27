const SUPPORTED_LOCALES = ["es-MX", "en-US"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "es-MX";

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
  const candidates = [
    input.userPreference,
    input.browserLanguage,
    input.acceptLanguage,
    input.programDefault,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    // Try exact match first
    if (isSupportedLocale(candidate)) return candidate;
    // Try matching just the language part (e.g., "es" → "es-MX")
    const lang = candidate.split("-")[0];
    if (lang) {
      const match = SUPPORTED_LOCALES.find((l) => l.startsWith(lang));
      if (match) return match;
    }
  }

  return DEFAULT_LOCALE;
}
