import "./ui/error-message.js";
import "./ui/spinner.js";
import "./loyalty-badges-gallery.js";
import "./loyalty-points-card.js";
import "./loyalty-reward-detail.js";
import "./loyalty-rewards-catalog.js";
import "./loyalty-tier-card.js";
import "./loyalty-transactions-list.js";

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import { fetchApi } from "../lib/api-client.js";
import { WidgetConfigController } from "../lib/widget-config.js";
import type { MemberProfile } from "../types.js";

type Tab = "home" | "points" | "badges" | "rewards" | "tier" | "history" | "profile";

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "points", label: "Points" },
  { id: "badges", label: "Badges" },
  { id: "rewards", label: "Rewards" },
  { id: "tier", label: "Tier" },
  { id: "history", label: "History" },
  { id: "profile", label: "Profile" },
];

@customElement("loyalty-widget")
export class LoyaltyWidget extends LitElement {
  private controller = new WidgetConfigController(this);

  @state() private activeTab: Tab = "home";
  @state() private selectedRewardId: string | null = null;
  @state() private profile: MemberProfile | null = null;
  @state() private profileLoading = false;
  @state() private profileError = "";

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
      max-width: 800px;
      margin: 0 auto;
      padding: var(--loy-space-md, 16px);
      color: var(--loy-color-text, #0f172a);
      background: var(--loy-color-surface, #ffffff);
      min-height: 100vh;
    }
    .tabs {
      display: flex;
      gap: 2px;
      margin-bottom: var(--loy-space-lg, 24px);
      border-bottom: 2px solid var(--loy-color-border, #e2e8f0);
      overflow-x: auto;
    }
    .tab-btn {
      padding: var(--loy-space-sm, 8px) var(--loy-space-md, 16px);
      border: none;
      background: transparent;
      font-size: var(--loy-font-size-md, 14px);
      font-weight: var(--loy-font-weight-semibold, 600);
      color: var(--loy-color-text-secondary, #64748b);
      cursor: pointer;
      white-space: nowrap;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition:
        color var(--loy-transition, 150ms ease),
        border-color var(--loy-transition, 150ms ease);
    }
    .tab-btn:hover {
      color: var(--loy-color-text, #0f172a);
    }
    .tab-btn.active {
      color: var(--loy-color-primary, #7c3aed);
      border-bottom-color: var(--loy-color-primary, #7c3aed);
    }
    .content {
      min-height: 300px;
    }
    .home-grid {
      display: flex;
      flex-direction: column;
      gap: var(--loy-space-lg, 24px);
    }
    .profile-card {
      background: var(--loy-color-surface, #ffffff);
      border: 1px solid var(--loy-color-border, #e2e8f0);
      border-radius: var(--loy-radius-lg, 12px);
      padding: var(--loy-space-lg, 24px);
    }
    .profile-card h2 {
      margin: 0 0 var(--loy-space-md, 16px);
      font-size: var(--loy-font-size-xl, 24px);
      font-weight: var(--loy-font-weight-bold, 700);
    }
    .profile-field {
      margin-bottom: var(--loy-space-sm, 8px);
    }
    .profile-field label {
      display: block;
      font-size: var(--loy-font-size-sm, 12px);
      color: var(--loy-color-text-secondary, #64748b);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 2px;
    }
    .profile-field span {
      font-size: var(--loy-font-size-md, 14px);
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("loy-reward-select", this.onRewardSelect as EventListener);
    this.addEventListener("loy-reward-close", this.onRewardClose as EventListener);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("loy-reward-select", this.onRewardSelect as EventListener);
    this.removeEventListener("loy-reward-close", this.onRewardClose as EventListener);
  }

  private onRewardSelect = (e: CustomEvent): void => {
    const detail = e.detail as { rewardId: string };
    this.selectedRewardId = detail.rewardId;
  };

  private onRewardClose = (): void => {
    this.selectedRewardId = null;
  };

  private switchTab(tab: Tab): void {
    this.activeTab = tab;
    this.selectedRewardId = null;
    if (tab === "profile" && !this.profile && !this.profileLoading) {
      void this.fetchProfile();
    }
  }

  private fetchProfile = async (): Promise<void> => {
    if (!this.controller.hasConfig) return;
    this.profileLoading = true;
    this.profileError = "";
    try {
      this.profile = await fetchApi<MemberProfile>(
        this.controller.config,
        `/members/${this.controller.config.memberId}`,
      );
    } catch (err) {
      this.profileError = (err as Error).message;
    } finally {
      this.profileLoading = false;
    }
  };

  private renderHomeTab() {
    return html`
      <div class="home-grid">
        <loyalty-points-card></loyalty-points-card>
        <loyalty-tier-card></loyalty-tier-card>
        <loyalty-badges-gallery></loyalty-badges-gallery>
      </div>
    `;
  }

  private renderRewardsTab() {
    if (this.selectedRewardId) {
      return html`<loyalty-reward-detail
        reward-id=${this.selectedRewardId}
      ></loyalty-reward-detail>`;
    }
    return html`<loyalty-rewards-catalog></loyalty-rewards-catalog>`;
  }

  private renderProfileTab() {
    if (this.profileLoading) return html`<loy-spinner></loy-spinner>`;
    if (this.profileError)
      return html`<loy-error
        message=${this.profileError}
        retryable
        @loy-retry=${() => {
          void this.fetchProfile();
        }}
      ></loy-error>`;
    if (!this.profile) return null;

    const p = this.profile;
    return html`
      <div class="profile-card">
        <h2>${p.firstName ? `${p.firstName} ${p.lastName ?? ""}` : "Member"}</h2>
        <div class="profile-field">
          <label>Member ID</label>
          <span>${p.id}</span>
        </div>
        ${p.email
          ? html`
              <div class="profile-field">
                <label>Email</label>
                <span>${p.email}</span>
              </div>
            `
          : null}
        ${p.phone
          ? html`
              <div class="profile-field">
                <label>Phone</label>
                <span>${p.phone}</span>
              </div>
            `
          : null}
        ${p.externalId
          ? html`
              <div class="profile-field">
                <label>External ID</label>
                <span>${p.externalId}</span>
              </div>
            `
          : null}
        <div class="profile-field">
          <label>Joined</label>
          <span>${new Date(p.joinedAt).toLocaleDateString()}</span>
        </div>
        ${p.tags.length > 0
          ? html`
              <div class="profile-field">
                <label>Tags</label>
                <span>${p.tags.join(", ")}</span>
              </div>
            `
          : null}
      </div>
    `;
  }

  private renderTabContent() {
    switch (this.activeTab) {
      case "home":
        return this.renderHomeTab();
      case "points":
        return html`<loyalty-points-card></loyalty-points-card>`;
      case "badges":
        return html`<loyalty-badges-gallery></loyalty-badges-gallery>`;
      case "rewards":
        return this.renderRewardsTab();
      case "tier":
        return html`<loyalty-tier-card></loyalty-tier-card>`;
      case "history":
        return html`<loyalty-transactions-list></loyalty-transactions-list>`;
      case "profile":
        return this.renderProfileTab();
      default:
        return null;
    }
  }

  override render() {
    if (!this.controller.hasConfig) {
      return html`<div>
        Please provide configuration: api-key, api-url, program-id, member-id.
      </div>`;
    }

    return html`
      <nav class="tabs">
        ${TABS.map(
          (t) => html`
            <button
              class="tab-btn ${this.activeTab === t.id ? "active" : ""}"
              @click=${() => {
                this.switchTab(t.id);
              }}
            >
              ${t.label}
            </button>
          `,
        )}
      </nav>
      <div class="content">${this.renderTabContent()}</div>
    `;
  }
}
