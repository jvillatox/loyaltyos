import "./ui/error-message.js";
import "./ui/spinner.js";
import "./loyalty-badges-gallery.js";
import "./loyalty-points-card.js";
import "./loyalty-rewards-top3.js";
import "./loyalty-tier-card.js";

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import { WidgetConfigController } from "../lib/widget-config.js";

@customElement("loyalty-widget")
export class LoyaltyWidget extends LitElement {
  private controller = new WidgetConfigController(this);

  @state() private authDismissed = false;

  static override styles = css`
    :host {
      display: block;
      font-family: var(
        --loy-font-family,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Roboto,
        sans-serif
      );
      max-width: 420px;
      margin: 0 auto;
      color: var(--loy-color-text, #0f172a);
      background: var(--loy-color-surface, #ffffff);
      border-radius: var(--loy-radius-lg, 12px);
      box-shadow: var(--loy-shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05));
      overflow: hidden;
    }
    .widget-inner {
      padding: var(--loy-space-lg, 24px);
    }
    .auth-cta {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--loy-space-xl, 32px) var(--loy-space-lg, 24px);
      text-align: center;
      gap: var(--loy-space-md, 16px);
    }
    .auth-cta p {
      margin: 0;
      font-size: var(--loy-font-size-md, 14px);
      color: var(--loy-color-text-secondary, #64748b);
    }
    .auth-cta button {
      padding: var(--loy-space-sm, 8px) var(--loy-space-xl, 24px);
      background: var(--loy-color-primary, #7c3aed);
      color: var(--loy-color-primary-text, #ffffff);
      border: none;
      border-radius: var(--loy-radius-md, 8px);
      font-size: var(--loy-font-size-md, 14px);
      font-weight: var(--loy-font-weight-semibold, 600);
      cursor: pointer;
      transition: opacity var(--loy-transition, 150ms ease);
    }
    .auth-cta button:hover {
      opacity: 0.9;
    }
    .widget-section {
      margin-bottom: var(--loy-space-lg, 24px);
    }
    .widget-section:last-child {
      margin-bottom: 0;
    }
    .section-title {
      font-size: var(--loy-font-size-sm, 12px);
      font-weight: var(--loy-font-weight-semibold, 600);
      color: var(--loy-color-text-secondary, #64748b);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: var(--loy-space-md, 12px);
    }
    .portal-link {
      display: block;
      text-align: center;
      padding: var(--loy-space-md, 16px) 0 0;
      font-size: var(--loy-font-size-md, 14px);
      color: var(--loy-color-primary, #7c3aed);
      text-decoration: none;
      font-weight: var(--loy-font-weight-semibold, 600);
    }
    .portal-link:hover {
      text-decoration: underline;
    }
    .mini-layout {
      display: flex;
      flex-direction: column;
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("loyaltyos:auth-required", this.onAuthRequired);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("loyaltyos:auth-required", this.onAuthRequired);
  }

  private onAuthRequired = (): void => {
    this.authDismissed = false;
    this.requestUpdate();
  };

  private handleSignIn = (): void => {
    const config = this.controller.config;
    const portalBase = config.apiBase.replace(/\/api$/, "");
    const loginUrl = `https://${portalBase}/portal/login`;
    window.open(loginUrl, "loyaltyos-portal", "width=480,height=720");
  };

  private applyTheme(): void {
    if (!this.controller.hasConfig) return;
    const config = this.controller.config;
    const isDark =
      config.theme === "dark" ||
      (config.theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    const s = this.style;
    s.setProperty("--loy-color-primary", config.accentColor);
    s.setProperty("--loy-color-primary-text", "#ffffff");
    s.setProperty("--loy-color-text", isDark ? "#f1f5f9" : "#0f172a");
    s.setProperty("--loy-color-text-secondary", isDark ? "#94a3b8" : "#64748b");
    s.setProperty("--loy-color-surface", isDark ? "#1e293b" : "#ffffff");
    s.setProperty("--loy-color-surface-secondary", isDark ? "#334155" : "#f1f5f9");
    s.setProperty("--loy-color-border", isDark ? "#334155" : "#e2e8f0");
  }

  override render() {
    if (!this.controller.hasConfig) {
      return html`<div class="widget-inner">
        Please provide configuration: program-id, api-base.
      </div>`;
    }

    this.applyTheme();
    const config = this.controller.config;

    if (!this.controller.isAuthenticated && !this.authDismissed) {
      return html`
        <div class="auth-cta">
          <p>Sign in to view your loyalty rewards</p>
          <button @click=${this.handleSignIn}>Sign in</button>
          <a
            href="#"
            style="font-size:12px;color:var(--loy-color-text-secondary);text-decoration:underline"
            @click=${(e: Event) => {
              e.preventDefault();
              this.authDismissed = true;
              this.requestUpdate();
            }}
            >Not now</a
          >
        </div>
      `;
    }

    const portalBase = config.apiBase.replace(/\/api$/, "");
    const portalUrl = `https://${portalBase}/portal`;

    if (config.mode === "mini") {
      return html`
        <div class="widget-inner mini-layout">
          <div class="widget-section">
            <loyalty-points-card></loyalty-points-card>
          </div>
          <a class="portal-link" href=${portalUrl} target="_blank" rel="noopener"
            >View rewards in portal</a
          >
        </div>
      `;
    }

    return html`
      <div class="widget-inner">
        <div class="widget-section">
          <loyalty-points-card></loyalty-points-card>
        </div>
        <div class="widget-section">
          <div class="section-title">Badges</div>
          <loyalty-badges-gallery></loyalty-badges-gallery>
        </div>
        <div class="widget-section">
          <div class="section-title">Top Rewards</div>
          <loyalty-rewards-top3></loyalty-rewards-top3>
        </div>
        <div class="widget-section">
          <div class="section-title">Your Tier</div>
          <loyalty-tier-card></loyalty-tier-card>
        </div>
        <a class="portal-link" href=${portalUrl} target="_blank" rel="noopener">Open full portal</a>
      </div>
    `;
  }
}
