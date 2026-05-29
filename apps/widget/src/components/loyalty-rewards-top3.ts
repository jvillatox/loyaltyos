import "./ui/empty-state.js";
import "./ui/error-message.js";
import "./ui/spinner.js";

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import { widgetT } from "../i18n.js";
import { fetchApi } from "../lib/api-client.js";
import { formatPoints } from "../lib/format.js";
import { WidgetConfigController } from "../lib/widget-config.js";
import type { RewardSummary } from "../types.js";

@customElement("loyalty-rewards-top3")
export class LoyaltyRewardsTop3 extends LitElement {
  private controller = new WidgetConfigController(this);

  @state() private rewards: RewardSummary[] | null = null;
  @state() private loading = false;
  @state() private error = "";

  static override styles = css`
    :host {
      display: block;
      font-family: var(--loy-font-family);
    }
    .rewards-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--loy-space-md);
    }
    .reward-card {
      background: var(--loy-color-surface);
      border: 1px solid var(--loy-color-border);
      border-radius: var(--loy-radius-lg);
      overflow: hidden;
      transition: box-shadow var(--loy-transition);
    }
    .reward-card:hover {
      box-shadow: var(--loy-shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
    }
    .reward-image {
      width: 100%;
      height: 96px;
      object-fit: cover;
      background: var(--loy-color-surface-secondary);
    }
    .reward-image-placeholder {
      width: 100%;
      height: 96px;
      background: var(--loy-color-surface-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      color: var(--loy-color-text-secondary);
    }
    .reward-body {
      padding: var(--loy-space-md);
    }
    .reward-name {
      font-size: var(--loy-font-size-md);
      font-weight: var(--loy-font-weight-semibold);
      color: var(--loy-color-text);
      margin-bottom: var(--loy-space-xs);
    }
    .reward-cost {
      font-size: var(--loy-font-size-lg);
      font-weight: var(--loy-font-weight-bold);
      color: var(--loy-color-primary);
    }
  `;

  override firstUpdated(): void {
    void this.fetchData();
  }

  private fetchData = async (): Promise<void> => {
    if (!this.controller.hasConfig || !this.controller.isAuthenticated) return;
    this.loading = true;
    this.error = "";
    try {
      this.rewards = await fetchApi<RewardSummary[]>(
        this.controller.config,
        `/rewards?isActive=true&pageSize=3&page=1`,
      );
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
    if (!this.rewards || this.rewards.length === 0) {
      return html`<loy-empty
        title=${widgetT("widget.noRewardsTitle", undefined, locale)}
        description=${widgetT("widget.noRewardsDesc", undefined, locale)}
      ></loy-empty>`;
    }

    return html`
      <div class="rewards-row">
        ${this.rewards.map(
          (r) => html`
            <div class="reward-card">
              ${r.imageUrl
                ? html`<img class="reward-image" src=${r.imageUrl} alt=${r.name} />`
                : html`<div class="reward-image-placeholder">&#127873;</div>`}
              <div class="reward-body">
                <div class="reward-name">${r.name}</div>
                <div class="reward-cost">${formatPoints(r.pointsCost, locale)}</div>
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }
}
