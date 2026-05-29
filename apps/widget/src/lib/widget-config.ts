import type { ReactiveController, ReactiveControllerHost } from "lit";

import { DEFAULT_CONFIG, type WidgetConfig, type WidgetLocale } from "../types.js";

interface AttributeDef {
  attr: string;
  key: keyof WidgetConfig;
  parse: (raw: string) => unknown;
}

const ATTRS: AttributeDef[] = [
  { attr: "program-id", key: "programId", parse: String },
  { attr: "api-base", key: "apiBase", parse: String },
  { attr: "auth-token", key: "authToken", parse: (s) => s || null },
  {
    attr: "theme",
    key: "theme",
    parse: (s) => (["light", "dark", "auto"].includes(s) ? s : "auto"),
  },
  { attr: "accent-color", key: "accentColor", parse: (s) => s || "#7c3aed" },
  {
    attr: "data-lang",
    key: "locale",
    parse: (s) => (["es-MX", "en-US"].includes(s) ? s : "es-MX"),
  },
  {
    attr: "locale",
    key: "locale",
    parse: (s) => (["es-MX", "en-US"].includes(s) ? s : "es-MX"),
  },
  { attr: "compact", key: "compact", parse: (s) => s === "true" },
  {
    attr: "mode",
    key: "mode",
    parse: (s) => (["mini", "full"].includes(s) ? s : "full"),
  },
];

function resolveDefaultLocale(): WidgetLocale {
  // 1. URL ?lang=
  try {
    const params = new URLSearchParams(window.location.search);
    const queryLang = params.get("lang");
    if (queryLang === "es-MX" || queryLang === "en-US") return queryLang;
  } catch {
    // ignore
  }

  // 2. navigator.language
  try {
    const nav = navigator.language;
    if (nav.startsWith("es")) return "es-MX";
    if (nav.startsWith("en")) return "en-US";
  } catch {
    // ignore
  }

  // 3. Hard fallback
  return "es-MX";
}

export class WidgetConfigController implements ReactiveController {
  private host: ReactiveControllerHost & HTMLElement;
  private _config: WidgetConfig | null = null;

  constructor(host: ReactiveControllerHost & HTMLElement) {
    this.host = host;
    host.addController(this);
  }

  hostConnected(): void {
    this.resolveConfig();
  }

  hostUpdate(): void {
    this.resolveConfig();
  }

  get config(): WidgetConfig {
    if (!this._config) {
      throw new Error("WidgetConfig not available. Set attributes: program-id, api-base.");
    }
    return this._config;
  }

  get hasConfig(): boolean {
    return this._config !== null;
  }

  get isAuthenticated(): boolean {
    return this._config?.authToken != null && this._config.authToken.length > 0;
  }

  /** Resolved locale from attributes, query string, or navigator. */
  get locale(): WidgetLocale {
    return this._config?.locale ?? resolveDefaultLocale();
  }

  private resolveConfig(): void {
    const partial: Record<string, unknown> = { ...DEFAULT_CONFIG };

    for (const { attr, key, parse } of ATTRS) {
      let value: string | null = this.host.getAttribute(attr);
      if (value === null) {
        const parent = this.host.closest("loyalty-widget");
        if (parent) value = parent.getAttribute(attr);
      }
      if (value !== null) {
        partial[key] = parse(value);
      }
    }

    // If locale was not set via attributes, compute from environment
    if (!partial.locale || partial.locale === DEFAULT_CONFIG.locale) {
      partial.locale = resolveDefaultLocale();
    }

    if (typeof partial.programId === "string" && typeof partial.apiBase === "string") {
      this._config = partial as unknown as WidgetConfig;
    }
  }
}
