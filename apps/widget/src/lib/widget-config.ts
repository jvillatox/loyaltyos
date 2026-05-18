import type { ReactiveController, ReactiveControllerHost } from "lit";

import type { WidgetConfig } from "../types.js";

const CONFIG_KEYS: (keyof WidgetConfig)[] = ["apiKey", "apiUrl", "programId", "memberId"];

const ATTR_MAP: Record<keyof WidgetConfig, string> = {
  apiKey: "api-key",
  apiUrl: "api-url",
  programId: "program-id",
  memberId: "member-id",
};

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
      throw new Error(
        "WidgetConfig not available. Set attributes: api-key, api-url, program-id, member-id.",
      );
    }
    return this._config;
  }

  get hasConfig(): boolean {
    return this._config !== null;
  }

  private resolveConfig(): void {
    const config: Partial<WidgetConfig> = {};

    for (const key of CONFIG_KEYS) {
      const attr = ATTR_MAP[key];
      // First check own attribute
      let value: string | null = this.host.getAttribute(attr);
      // Fall back to closest loyalty-widget ancestor
      if (!value) {
        const parent = this.host.closest("loyalty-widget");
        if (parent) {
          value = parent.getAttribute(attr);
        }
      }
      if (value) {
        (config as Record<string, string>)[key] = value;
      }
    }

    if (config.apiKey && config.apiUrl && config.programId && config.memberId) {
      this._config = config as WidgetConfig;
    }
  }
}
