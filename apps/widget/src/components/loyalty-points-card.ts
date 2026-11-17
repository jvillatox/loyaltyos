import "./ui/error-message.js";
import "./ui/spinner.js";

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import { widgetT } from "../i18n.js";
import { fetchApi } from "../lib/api-client.js";
import { formatPoints } from "../lib/format.js";
import { WidgetConfigController } from "../lib/widget-config.js";
import type { Balance } from "../types.js";

@customElement("loyalty-points-card")
export class LoyaltyPointsCard extends LitElement {
  private controller = new WidgetConfigController(this);

  @state() private data: Balance | null = null;
  @state() private loading = false;
  @state() private error = "";

  static override styles = css`
    :host {
      display: block;
      font-family: var(--loy-font-family);
    }
    .balance-card {
      background: var(--loy-color-surface);
      border: 1px solid var(--loy-color-border);
      border-radius: var(--loy-radius-lg);
      padding: var(--loy-space-lg);
      text-align: center;
    }
    .balance-label {
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-text-secondary);
      margin-bottom: var(--loy-space-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .balance-value {
      font-size: var(--loy-font-size-xl);
      font-weight: var(--loy-font-weight-bold);
      color: var(--loy-color-text);
    }
    .release-note {
      margin: var(--loy-space-md) 0 0;
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-text-secondary);
    }
  `;

  private onBalanceUpdated = (): void => {
    void this.fetchData();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("loyaltyos:balance-updated", this.onBalanceUpdated);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("loyaltyos:balance-updated", this.onBalanceUpdated);
  }

  override firstUpdated(): void {
    void this.fetchData();
  }

  private fetchData = async (): Promise<void> => {
    if (!this.controller.hasConfig || !this.controller.isAuthenticated) return;
    this.loading = true;
    this.error = "";
    try {
      this.data = await fetchApi<Balance>(this.controller.config, `/members/me/balance`);
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loading = false;
    }
  };

  override render() {
    if (!this.controller.isAuthenticated) return null;
    const locale = this.controller.locale;
    if (this.loading) return html`<loy-spinner .locale=${locale}></loy-spinner>`;
    if (this.error)
      return html`<loy-error
        message=${this.error}
        retryable
        .locale=${locale}
        @loy-retry=${this.fetchData}
      ></loy-error>`;
    if (!this.data) return null;

    const expiry = this.computeExpiry(this.data.nextExpiry);

    return html`
      <div class="balance-card">
        <div class="balance-label">${widgetT("widget.availableBalance", undefined, locale)}</div>
        <div class="balance-value">${formatPoints(this.data.confirmed, locale)}</div>
        ${this.data.pendingBalance > 0 && this.data.nextAvailableAt
          ? html`<p class="release-note">
              ${widgetT(
                "widget.pointsToRelease",
                {
                  points: formatPoints(this.data.pendingBalance, locale),
                  date: new Date(this.data.nextAvailableAt).toLocaleDateString(locale),
                },
                locale,
              )}
            </p>`
          : ""}
        ${expiry
          ? html`<p class="release-note">
              ${expiry.mode === "INACTIVITY"
                ? widgetT(
                    "widget.pointsExpireInactivity",
                    { date: expiry.date.toLocaleDateString(locale) },
                    locale,
                  )
                : widgetT(
                    "widget.pointsExpireOn",
                    {
                      points: formatPoints(expiry.amount, locale),
                      date: expiry.date.toLocaleDateString(locale),
                    },
                    locale,
                  )}
            </p>`
          : ""}
      </div>
    `;
  }

  private computeExpiry(nextExpiry: Balance["nextExpiry"]): {
    amount: number;
    date: Date;
    mode: "PER_LOT" | "INACTIVITY";
  } | null {
    if (!nextExpiry) return null;
    const date = new Date(nextExpiry.date);
    const daysUntil = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
    if (daysUntil < 0 || daysUntil > 90) return null;
    return { amount: nextExpiry.amount, date, mode: nextExpiry.mode };
  }
}
