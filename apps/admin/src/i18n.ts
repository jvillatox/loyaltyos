import enUS from "@loyaltyos/i18n/src/locales/en-US.json" with { type: "json" };
import esMX from "@loyaltyos/i18n/src/locales/es-MX.json" with { type: "json" };
import { createInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

const LOCALE_STORAGE_KEY = "loyaltyos:locale";

export function getStoredLocale(): string {
  return localStorage.getItem(LOCALE_STORAGE_KEY) ?? "es-MX";
}

export function persistLocale(locale: string): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

const i18n = createInstance();

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: getStoredLocale(),
    fallbackLng: "es-MX",
    supportedLngs: ["es-MX", "en-US"],
    resources: {
      "es-MX": { translation: esMX },
      "en-US": { translation: enUS },
    },
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

export default i18n;
