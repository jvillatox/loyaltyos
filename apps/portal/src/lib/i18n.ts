import enUS from "@loyaltyos/i18n/src/locales/en-US.json" with { type: "json" };
import esMX from "@loyaltyos/i18n/src/locales/es-MX.json" with { type: "json" };
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { fetchApi, patchApi } from "./api-client";
import { isAuthenticated } from "./auth";

void i18n.use(initReactI18next).init({
  resources: {
    "es-MX": esMX,
    "en-US": enUS,
  },
  lng: "es-MX",
  fallbackLng: "es-MX",
  supportedLngs: ["es-MX", "en-US"],
  defaultNS: "portal",
  interpolation: { escapeValue: false },
});

const STORAGE_KEY = "loyaltyos-locale";
const SUPPORTED = ["es-MX", "en-US"] as const;

function isValidLocale(v: string | null | undefined): v is "es-MX" | "en-US" {
  return v != null && SUPPORTED.includes(v as (typeof SUPPORTED)[number]);
}

function matchNavigatorLocale(): "es-MX" | "en-US" | null {
  try {
    const nav = navigator.language;
    if (nav.startsWith("es")) return "es-MX";
    if (nav.startsWith("en")) return "en-US";
  } catch {
    // ignore
  }
  return null;
}

export async function bootstrapLocale(): Promise<void> {
  // 1. URL ?lang=
  try {
    const params = new URLSearchParams(window.location.search);
    const queryLang = params.get("lang");
    if (isValidLocale(queryLang)) {
      await i18n.changeLanguage(queryLang);
      sessionStorage.setItem(STORAGE_KEY, queryLang);
      return;
    }
  } catch {
    // ignore invalid URL
  }

  // 2. sessionStorage
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (isValidLocale(stored)) {
    await i18n.changeLanguage(stored);
    return;
  }

  // 3. /auth/me API (if authenticated)
  if (isAuthenticated()) {
    try {
      const profile = await fetchApi<{
        locale: string | null;
        program: { defaultLocale: string; supportedLocales: string[] };
      }>("/auth/me");
      const memberLocale = profile.locale ?? profile.program.defaultLocale;
      if (isValidLocale(memberLocale)) {
        await i18n.changeLanguage(memberLocale);
        sessionStorage.setItem(STORAGE_KEY, memberLocale);
        return;
      }
    } catch {
      // Swallow — proceed to next step
    }
  }

  // 4. navigator.language
  const navLocale = matchNavigatorLocale();
  if (navLocale) {
    await i18n.changeLanguage(navLocale);
    sessionStorage.setItem(STORAGE_KEY, navLocale);
    return;
  }

  // 5. Hard fallback
  await i18n.changeLanguage("es-MX");
  sessionStorage.setItem(STORAGE_KEY, "es-MX");
}

export async function setUserLocale(locale: string): Promise<void> {
  if (!isValidLocale(locale)) return;

  await i18n.changeLanguage(locale);
  sessionStorage.setItem(STORAGE_KEY, locale);

  // Persist to server if authenticated (fire-and-forget)
  if (isAuthenticated()) {
    try {
      await patchApi<unknown>("/members/me", { locale });
    } catch {
      // Swallow — sessionStorage is the user-facing source of truth
    }
  }
}

export default i18n;
