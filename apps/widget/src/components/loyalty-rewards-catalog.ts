import "./ui/empty-state.js";
import "./ui/error-message.js";
import "./ui/pagination.js";
import "./ui/spinner.js";

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import { fetchApi } from "../lib/api-client.js";
import { formatPoints } from "../lib/format.js";
import { WidgetConfigController } from "../lib/widget-config.js";
import type { PaginatedResponse, RewardRow } from "../types.js";

const CATEGORIES = [
  "DISCOUNT_FUTURE",
  "PHYSICAL_PRODUCT",
  "GIFT_CARD",
  "EXPERIENCE",
  "CHARITY_DONATION",
  "COALITION_TRANSFER",
];

@customElement("loyalty-rewards-catalog")
export class LoyaltyRewardsCatalog extends LitElement {
  private controller = new WidgetConfigController(this);

  @state() private data: PaginatedResponse<RewardRow> | null = null;
  @state() private loading = false;
  @state() private error = "";
  @state() private page = 1;
  @state() private category = "";
  @state() private minPoints = "";
  @state() private maxPoints = "";
  private pageSize = 12;

  static override styles = css`
    :host {
      display: block;
      font-family: var(--loy-font-family);
    }
    .filters {
      display: flex;
      gap: var(--loy-space-sm);
      margin-bottom: var(--loy-space-md);
      flex-wrap: wrap;
    }
    select,
    input {
      padding: var(--loy-space-sm);
      border: 1px solid var(--loy-color-border);
      border-radius: var(--loy-radius-sm);
      font-size: var(--loy-font-size-md);
      font-family: var(--loy-font-family);
      background: var(--loy-color-surface);
      color: var(--loy-color-text);
    }
    select {
      min-width: 160px;
    }
    input {
      width: 100px;
    }
    .rewards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: var(--loy-space-md);
    }
    .reward-card {
      background: var(--loy-color-surface);
      border: 1px solid var(--loy-color-border);
      border-radius: var(--loy-radius-lg);
      padding: var(--loy-space-md);
      cursor: pointer;
      transition:
        box-shadow var(--loy-transition),
        transform var(--loy-transition);
    }
    .reward-card:hover {
      box-shadow: var(--loy-shadow-card);
      transform: translateY(-1px);
    }
    .reward-image {
      width: 100%;
      height: 100px;
      object-fit: cover;
      border-radius: var(--loy-radius-sm);
      margin-bottom: var(--loy-space-sm);
      background: var(--loy-color-surface-secondary);
    }
    .reward-placeholder {
      width: 100%;
      height: 100px;
      border-radius: var(--loy-radius-sm);
      margin-bottom: var(--loy-space-sm);
      background: var(--loy-color-surface-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      color: var(--loy-color-text-secondary);
    }
    .reward-name {
      font-size: var(--loy-font-size-md);
      font-weight: var(--loy-font-weight-semibold);
      color: var(--loy-color-text);
      margin-bottom: var(--loy-space-xs);
    }
    .reward-cost {
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-primary);
      font-weight: var(--loy-font-weight-semibold);
    }
    .reward-category {
      display: inline-block;
      margin-top: var(--loy-space-xs);
      padding: 1px 6px;
      border-radius: var(--loy-radius-full);
      font-size: var(--loy-font-size-sm);
      background: var(--loy-color-surface-secondary);
      color: var(--loy-color-text-secondary);
    }
    .out-of-stock {
      opacity: 0.5;
    }
    .out-of-stock .reward-card {
      cursor: not-allowed;
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
      const params = new URLSearchParams();
      params.set("page", String(this.page));
      params.set("pageSize", String(this.pageSize));
      if (this.category) params.set("category", this.category);
      if (this.minPoints) params.set("minPoints", this.minPoints);
      if (this.maxPoints) params.set("maxPoints", this.maxPoints);

      this.data = await fetchApi<PaginatedResponse<RewardRow>>(
        this.controller.config,
        `/rewards?${params.toString()}`,
      );
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loading = false;
    }
  };

  private onCategoryChange(e: Event): void {
    this.category = (e.target as HTMLSelectElement).value;
    this.page = 1;
    void this.fetchData();
  }

  private onMinPointsChange(e: Event): void {
    this.minPoints = (e.target as HTMLInputElement).value;
    this.page = 1;
    void this.fetchData();
  }

  private onMaxPointsChange(e: Event): void {
    this.maxPoints = (e.target as HTMLInputElement).value;
    this.page = 1;
    void this.fetchData();
  }

  private onPageChange(e: CustomEvent): void {
    const detail = e.detail as { page: number };
    this.page = detail.page;
    void this.fetchData();
  }

  private selectReward(reward: RewardRow): void {
    this.dispatchEvent(
      new CustomEvent("loy-reward-select", {
        detail: { rewardId: reward.id },
        bubbles: true,
        composed: true,
      }),
    );
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

    return html`
      <div class="filters">
        <select
          @change=${(e: Event) => {
            this.onCategoryChange(e);
          }}
        >
          <option value="">All Categories</option>
          ${CATEGORIES.map((c) => html`<option value=${c}>${c.replace(/_/g, " ")}</option>`)}
        </select>
        <input
          type="number"
          placeholder="Min pts"
          .value=${this.minPoints}
          @change=${(e: Event) => {
            this.onMinPointsChange(e);
          }}
        />
        <input
          type="number"
          placeholder="Max pts"
          .value=${this.maxPoints}
          @change=${(e: Event) => {
            this.onMaxPointsChange(e);
          }}
        />
      </div>

      ${!this.data || this.data.items.length === 0
        ? html`<loy-empty
            title="No rewards found"
            description="Try adjusting your filters"
          ></loy-empty>`
        : html`
            <div class="rewards-grid">
              ${this.data.items.map(
                (r: RewardRow) => html`
                  <div
                    class="reward-card ${r.stock === 0 ? "out-of-stock" : ""}"
                    @click=${() => {
                      this.selectReward(r);
                    }}
                  >
                    ${r.imageUrl
                      ? html`<img class="reward-image" src=${r.imageUrl} alt=${r.name} />`
                      : html`<div class="reward-placeholder">&#127873;</div>`}
                    <div class="reward-name">${r.name}</div>
                    <div class="reward-cost">${formatPoints(r.pointsCost)}</div>
                    ${r.category
                      ? html`<span class="reward-category">${r.category.replace(/_/g, " ")}</span>`
                      : null}
                  </div>
                `,
              )}
            </div>
            <loy-pagination
              page=${this.data.page}
              .totalPages=${this.data.totalPages}
              @loy-page-change=${(e: CustomEvent) => {
                this.onPageChange(e);
              }}
            ></loy-pagination>
          `}
    `;
  }
}
