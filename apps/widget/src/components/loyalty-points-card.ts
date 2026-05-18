import "./ui/error-message.js";
import "./ui/spinner.js";

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

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
    .balance-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--loy-space-md);
    }
    .stat {
      background: var(--loy-color-surface);
      border: 1px solid var(--loy-color-border);
      border-radius: var(--loy-radius-lg);
      padding: var(--loy-space-lg);
      text-align: center;
    }
    .stat-label {
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-text-secondary);
      margin-bottom: var(--loy-space-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .stat-value {
      font-size: var(--loy-font-size-xl);
      font-weight: var(--loy-font-weight-bold);
      color: var(--loy-color-text);
    }
    .stat-value.confirmed {
      color: var(--loy-color-success);
    }
    .stat-value.pending {
      color: var(--loy-color-warning);
    }
  `;

  private onRedeemed = (): void => {
    void this.fetchData();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("widget:redeemed", this.onRedeemed);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("widget:redeemed", this.onRedeemed);
  }

  override firstUpdated(): void {
    void this.fetchData();
  }

  private fetchData = async (): Promise<void> => {
    if (!this.controller.hasConfig) return;
    this.loading = true;
    this.error = "";
    try {
      this.data = await fetchApi<Balance>(
        this.controller.config,
        `/members/${this.controller.config.memberId}/balance`,
      );
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loading = false;
    }
  };

  override render() {
    if (this.loading) return html`<loy-spinner></loy-spinner>`;
    if (this.error)
      return html`<loy-error
        message=${this.error}
        retryable
        @loy-retry=${this.fetchData}
      ></loy-error>`;
    if (!this.data) return null;

    return html`
      <div class="balance-grid">
        <div class="stat">
          <div class="stat-label">Confirmed</div>
          <div class="stat-value confirmed">${formatPoints(this.data.confirmed)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Pending</div>
          <div class="stat-value pending">${formatPoints(this.data.pending)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Total</div>
          <div class="stat-value">${formatPoints(this.data.total)}</div>
        </div>
      </div>
    `;
  }
}
