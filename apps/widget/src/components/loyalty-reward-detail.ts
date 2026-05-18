import "./ui/error-message.js";
import "./ui/spinner.js";

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import { fetchApi, postApi } from "../lib/api-client.js";
import { formatPoints } from "../lib/format.js";
import { generateIdempotencyKey } from "../lib/idempotency.js";
import { WidgetConfigController } from "../lib/widget-config.js";
import type { RedeemResult, RewardDetail } from "../types.js";

@customElement("loyalty-reward-detail")
export class LoyaltyRewardDetail extends LitElement {
  private controller = new WidgetConfigController(this);

  @state() private data: RewardDetail | null = null;
  @state() private loading = false;
  @state() private error = "";
  @state() private redeeming = false;
  @state() private redeemError = "";
  @state() private redeemSuccess = false;

  static override styles = css`
    :host {
      display: block;
      font-family: var(--loy-font-family);
    }
    .detail {
      background: var(--loy-color-surface);
      border: 1px solid var(--loy-color-border);
      border-radius: var(--loy-radius-lg);
      overflow: hidden;
    }
    .detail-image {
      width: 100%;
      height: 200px;
      object-fit: cover;
      background: var(--loy-color-surface-secondary);
    }
    .detail-placeholder {
      width: 100%;
      height: 200px;
      background: var(--loy-color-surface-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
    }
    .detail-body {
      padding: var(--loy-space-lg);
    }
    h2 {
      margin: 0 0 var(--loy-space-sm);
      font-size: var(--loy-font-size-xl);
      font-weight: var(--loy-font-weight-bold);
      color: var(--loy-color-text);
    }
    .description {
      color: var(--loy-color-text-secondary);
      font-size: var(--loy-font-size-md);
      margin-bottom: var(--loy-space-md);
      line-height: 1.5;
    }
    .meta {
      display: flex;
      gap: var(--loy-space-md);
      margin-bottom: var(--loy-space-md);
      flex-wrap: wrap;
    }
    .meta-item {
      padding: var(--loy-space-sm) var(--loy-space-md);
      background: var(--loy-color-surface-secondary);
      border-radius: var(--loy-radius-sm);
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-text-secondary);
    }
    .meta-item strong {
      color: var(--loy-color-text);
    }
    .eligibility {
      padding: var(--loy-space-md);
      border-radius: var(--loy-radius-sm);
      margin-bottom: var(--loy-space-md);
      font-size: var(--loy-font-size-md);
    }
    .eligibility.eligible {
      background: var(--loy-color-success-bg);
      color: var(--loy-color-success);
    }
    .eligibility.ineligible {
      background: var(--loy-color-danger-bg);
      color: var(--loy-color-danger);
    }
    button {
      width: 100%;
      padding: var(--loy-space-md);
      border: none;
      border-radius: var(--loy-radius-md);
      font-size: var(--loy-font-size-lg);
      font-weight: var(--loy-font-weight-semibold);
      font-family: var(--loy-font-family);
      cursor: pointer;
      transition: opacity var(--loy-transition);
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .redeem-btn {
      background: var(--loy-color-primary);
      color: var(--loy-color-primary-text);
    }
    .redeem-btn:hover:not(:disabled) {
      opacity: 0.9;
    }
    .back-btn {
      background: transparent;
      color: var(--loy-color-text-secondary);
      font-size: var(--loy-font-size-md);
      margin-bottom: var(--loy-space-md);
      padding: var(--loy-space-sm);
      text-align: left;
    }
    .success-msg {
      background: var(--loy-color-success-bg);
      color: var(--loy-color-success);
      padding: var(--loy-space-md);
      border-radius: var(--loy-radius-sm);
      text-align: center;
      font-weight: var(--loy-font-weight-semibold);
    }
    .redeem-error {
      background: var(--loy-color-danger-bg);
      color: var(--loy-color-danger);
      padding: var(--loy-space-md);
      border-radius: var(--loy-radius-sm);
      margin-bottom: var(--loy-space-md);
      font-size: var(--loy-font-size-md);
    }
  `;

  override firstUpdated(): void {
    void this.fetchData();
  }

  private fetchData = async (): Promise<void> => {
    if (!this.controller.hasConfig) return;
    this.loading = true;
    this.error = "";
    try {
      const rewardId = this.getAttribute("reward-id") ?? "";
      const config = this.controller.config;
      this.data = await fetchApi<RewardDetail>(
        config,
        `/rewards/${rewardId}?memberId=${config.memberId}`,
      );
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loading = false;
    }
  };

  private goBack(): void {
    this.dispatchEvent(new CustomEvent("loy-reward-close", { bubbles: true, composed: true }));
  }

  private async handleRedeem(): Promise<void> {
    if (!this.data || !this.controller.hasConfig) return;
    this.redeeming = true;
    this.redeemError = "";

    try {
      const config = this.controller.config;
      const result = await postApi<RedeemResult>(
        config,
        `/rewards/${this.data.id}/redeem`,
        {
          rewardId: this.data.id,
          memberId: config.memberId,
          idempotencyKey: generateIdempotencyKey(),
        },
        generateIdempotencyKey(),
      );

      this.redeemSuccess = true;
      this.dispatchEvent(
        new CustomEvent("widget:redeemed", {
          detail: result,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this.redeemError = (err as Error).message;
    } finally {
      this.redeeming = false;
    }
  }

  override render() {
    if (this.loading) return html`<loy-spinner></loy-spinner>`;
    if (this.error)
      return html`<loy-error
        message=${this.error}
        retryable
        @loy-retry=${() => {
          void this.fetchData();
        }}
      ></loy-error>`;
    if (!this.data) return null;

    const r = this.data;
    const eligible = this.data.eligible === true;

    return html`
      <button
        class="back-btn"
        @click=${() => {
          this.goBack();
        }}
      >
        &larr; Back to rewards
      </button>
      <div class="detail">
        ${r.imageUrl
          ? html`<img class="detail-image" src=${r.imageUrl} alt=${r.name} />`
          : html`<div class="detail-placeholder">&#127873;</div>`}
        <div class="detail-body">
          <h2>${r.name}</h2>
          ${r.description ? html`<p class="description">${r.description}</p>` : null}

          <div class="meta">
            <div class="meta-item"><strong>Cost:</strong> ${formatPoints(r.pointsCost)}</div>
            ${r.stock !== null
              ? html`<div class="meta-item"><strong>Stock:</strong> ${String(r.stock)}</div>`
              : null}
            ${r.category
              ? html`<div class="meta-item">
                  <strong>Category:</strong> ${r.category.replace(/_/g, " ")}
                </div>`
              : null}
            ${r.tierRequired
              ? html`<div class="meta-item"><strong>Tier:</strong> ${r.tierRequired}</div>`
              : null}
          </div>

          ${this.redeemError ? html`<div class="redeem-error">${this.redeemError}</div>` : null}
          ${this.redeemSuccess
            ? html`<div class="success-msg">Reward redeemed successfully!</div>`
            : null}
          ${!this.redeemSuccess && this.data.eligible !== undefined
            ? html`
                <div class="eligibility ${eligible ? "eligible" : "ineligible"}">
                  ${eligible
                    ? "You're eligible to redeem this reward!"
                    : (r.reason ?? "You are not eligible for this reward")}
                </div>
              `
            : null}

          <button
            class="redeem-btn"
            ?disabled=${!eligible || this.redeeming || this.redeemSuccess}
            @click=${() => {
              void this.handleRedeem();
            }}
          >
            ${this.redeeming ? "Redeeming..." : "Redeem Reward"}
          </button>
        </div>
      </div>
    `;
  }
}
