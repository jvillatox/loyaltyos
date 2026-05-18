import "./ui/empty-state.js";
import "./ui/error-message.js";
import "./ui/spinner.js";

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import { fetchApi } from "../lib/api-client.js";
import { WidgetConfigController } from "../lib/widget-config.js";
import type { BadgeProgress } from "../types.js";

@customElement("loyalty-badges-gallery")
export class LoyaltyBadgesGallery extends LitElement {
  private controller = new WidgetConfigController(this);

  @state() private badges: BadgeProgress[] | null = null;
  @state() private loading = false;
  @state() private error = "";

  static override styles = css`
    :host {
      display: block;
      font-family: var(--loy-font-family);
    }
    .badges-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: var(--loy-space-md);
    }
    .badge-card {
      background: var(--loy-color-surface);
      border: 1px solid var(--loy-color-border);
      border-radius: var(--loy-radius-lg);
      padding: var(--loy-space-md);
      text-align: center;
      transition: box-shadow var(--loy-transition);
    }
    .badge-card.unlocked {
      border-color: var(--loy-color-primary);
      box-shadow: 0 0 0 1px var(--loy-color-primary);
    }
    .badge-image {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      object-fit: cover;
      margin: 0 auto var(--loy-space-sm);
      background: var(--loy-color-surface-secondary);
    }
    .badge-placeholder {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      margin: 0 auto var(--loy-space-sm);
      background: var(--loy-color-surface-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      color: var(--loy-color-text-secondary);
    }
    .badge-name {
      font-size: var(--loy-font-size-md);
      font-weight: var(--loy-font-weight-semibold);
      color: var(--loy-color-text);
      margin-bottom: var(--loy-space-xs);
    }
    .badge-desc {
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-text-secondary);
      margin-bottom: var(--loy-space-sm);
    }
    .progress-bar {
      height: 6px;
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
    .progress-label {
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-text-secondary);
      margin-top: var(--loy-space-xs);
    }
    .unlocked-label {
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-success);
      font-weight: var(--loy-font-weight-semibold);
      margin-top: var(--loy-space-xs);
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
      this.badges = await fetchApi<BadgeProgress[]>(
        this.controller.config,
        `/members/${this.controller.config.memberId}/badges`,
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
    if (!this.badges || this.badges.length === 0) {
      return html`<loy-empty
        title="No badges yet"
        description="Keep earning points to unlock badges"
      ></loy-empty>`;
    }

    return html`
      <div class="badges-grid">
        ${this.badges.map(
          (b) => html`
            <div class="badge-card ${b.unlocked ? "unlocked" : ""}">
              ${b.badge.imageUrl
                ? html`<img class="badge-image" src=${b.badge.imageUrl} alt=${b.badge.name} />`
                : html`<div class="badge-placeholder">&#127942;</div>`}
              <div class="badge-name">${b.badge.name}</div>
              ${b.badge.description
                ? html`<div class="badge-desc">${b.badge.description}</div>`
                : null}
              ${b.unlocked
                ? html`<div class="unlocked-label">Unlocked</div>`
                : html`
                    <div class="progress-bar">
                      <div class="progress-fill" style="width:${String(b.progress)}%"></div>
                    </div>
                    <div class="progress-label">${String(b.progress)}%</div>
                  `}
            </div>
          `,
        )}
      </div>
    `;
  }
}
