import "./ui/error-message.js";
import "./ui/spinner.js";

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import { fetchApi } from "../lib/api-client.js";
import { formatPoints } from "../lib/format.js";
import { WidgetConfigController } from "../lib/widget-config.js";
import type { TierStatus } from "../types.js";

@customElement("loyalty-tier-card")
export class LoyaltyTierCard extends LitElement {
  private controller = new WidgetConfigController(this);

  @state() private data: TierStatus | null = null;
  @state() private loading = false;
  @state() private error = "";

  static override styles = css`
    :host {
      display: block;
      font-family: var(--loy-font-family);
    }
    .tier-card {
      background: var(--loy-color-surface);
      border: 1px solid var(--loy-color-border);
      border-radius: var(--loy-radius-lg);
      padding: var(--loy-space-lg);
    }
    .tier-header {
      display: flex;
      align-items: center;
      gap: var(--loy-space-md);
      margin-bottom: var(--loy-space-md);
    }
    .tier-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: var(--loy-font-weight-bold);
      color: var(--loy-color-primary-text);
    }
    .tier-info h3 {
      margin: 0;
      font-size: var(--loy-font-size-lg);
      font-weight: var(--loy-font-weight-bold);
      color: var(--loy-color-text);
    }
    .tier-info .rank {
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-text-secondary);
    }
    .progress-section {
      margin-top: var(--loy-space-md);
    }
    .progress-label-row {
      display: flex;
      justify-content: space-between;
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-text-secondary);
      margin-bottom: var(--loy-space-xs);
    }
    .progress-bar {
      height: 8px;
      background: var(--loy-color-border);
      border-radius: var(--loy-radius-full);
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--loy-color-primary);
      border-radius: var(--loy-radius-full);
      transition: width var(--loy-transition);
    }
    .max-tier {
      text-align: center;
      padding: var(--loy-space-md);
      color: var(--loy-color-success);
      font-weight: var(--loy-font-weight-semibold);
      font-size: var(--loy-font-size-lg);
    }
    .no-tier {
      text-align: center;
      padding: var(--loy-space-lg);
      color: var(--loy-color-text-secondary);
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
      this.data = await fetchApi<TierStatus>(
        this.controller.config,
        `/members/${this.controller.config.memberId}/tier`,
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

    const tier = this.data.currentTier;
    if (!tier) {
      return html`<div class="tier-card"><div class="no-tier">No tier assigned yet</div></div>`;
    }

    const progressPct = this.data.pointsProgress;

    return html`
      <div class="tier-card">
        <div class="tier-header">
          <div class="tier-icon" style="background:${tier.color ?? "var(--loy-color-primary)"}">
            ${tier.iconUrl
              ? html`<img
                  src=${tier.iconUrl}
                  alt=""
                  style="width:100%;height:100%;border-radius:50%"
                />`
              : tier.name.charAt(0)}
          </div>
          <div class="tier-info">
            <h3>${tier.name}</h3>
            <span class="rank">Rank ${String(tier.rank)}</span>
          </div>
        </div>

        ${this.data.nextTier
          ? html`
              <div class="progress-section">
                <div class="progress-label-row">
                  <span>Progress to ${this.data.nextTier.name}</span>
                  <span>${String(progressPct)}%</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill" style="width:${String(progressPct)}%"></div>
                </div>
                ${this.data.pointsToNext !== null
                  ? html`
                      <div class="progress-label-row" style="margin-top:var(--loy-space-xs)">
                        <span>${formatPoints(this.data.pointsToNext)} to go</span>
                        <span>${formatPoints(this.data.nextTier.minPoints)} needed</span>
                      </div>
                    `
                  : null}
              </div>
            `
          : html`<div class="max-tier">You've reached the highest tier!</div>`}
      </div>
    `;
  }
}
