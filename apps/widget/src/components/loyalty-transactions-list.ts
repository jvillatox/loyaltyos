import "./ui/empty-state.js";
import "./ui/error-message.js";
import "./ui/pagination.js";
import "./ui/spinner.js";

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import { fetchApi } from "../lib/api-client.js";
import { formatDate, formatPoints } from "../lib/format.js";
import { WidgetConfigController } from "../lib/widget-config.js";
import type { PaginatedResponse, PointTransaction } from "../types.js";

const TYPE_CLASS: Record<string, string> = {
  EARN: "positive",
  REDEEM: "negative",
  EXPIRE: "negative",
  REVERSE: "warning",
};

@customElement("loyalty-transactions-list")
export class LoyaltyTransactionsList extends LitElement {
  private controller = new WidgetConfigController(this);

  @state() private data: PaginatedResponse<PointTransaction> | null = null;
  @state() private loading = false;
  @state() private error = "";
  @state() private page = 1;
  private pageSize = 10;

  static override styles = css`
    :host {
      display: block;
      font-family: var(--loy-font-family);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      text-align: left;
      padding: var(--loy-space-sm) var(--loy-space-md);
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--loy-color-border);
    }
    td {
      padding: var(--loy-space-sm) var(--loy-space-md);
      font-size: var(--loy-font-size-md);
      color: var(--loy-color-text);
      border-bottom: 1px solid var(--loy-color-border);
    }
    .positive {
      color: var(--loy-color-success);
      font-weight: var(--loy-font-weight-semibold);
    }
    .negative {
      color: var(--loy-color-danger);
      font-weight: var(--loy-font-weight-semibold);
    }
    .warning {
      color: var(--loy-color-warning);
    }
    .type-chip {
      display: inline-block;
      padding: 2px 8px;
      border-radius: var(--loy-radius-full);
      font-size: var(--loy-font-size-sm);
      font-weight: var(--loy-font-weight-semibold);
      background: var(--loy-color-surface-secondary);
      border: 1px solid var(--loy-color-border);
    }
    .overflow-wrap {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;

  private onRedeemed = (): void => {
    void this.fetchData();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("widget:redeemed", this.onRedeemed);
    this.addEventListener("loy-page-change", this.onPageChange as EventListener);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("widget:redeemed", this.onRedeemed);
    this.removeEventListener("loy-page-change", this.onPageChange as EventListener);
  }

  override firstUpdated(): void {
    void this.fetchData();
  }

  private fetchData = async (): Promise<void> => {
    if (!this.controller.hasConfig) return;
    this.loading = true;
    this.error = "";
    try {
      this.data = await fetchApi<PaginatedResponse<PointTransaction>>(
        this.controller.config,
        `/members/${this.controller.config.memberId}/transactions?page=${String(this.page)}&pageSize=${String(this.pageSize)}`,
      );
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loading = false;
    }
  };

  private onPageChange = (e: CustomEvent): void => {
    const detail = e.detail as { page: number };
    this.page = detail.page;
    void this.fetchData();
  };

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
    if (!this.data || this.data.items.length === 0) {
      return html`<loy-empty
        title="No transactions yet"
        description="Your transaction history will appear here"
      ></loy-empty>`;
    }

    return html`
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Balance</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          ${this.data.items.map(
            (tx: PointTransaction) => html`
              <tr>
                <td>${formatDate(tx.createdAt)}</td>
                <td><span class="type-chip ${TYPE_CLASS[tx.type] ?? ""}">${tx.type}</span></td>
                <td class="${tx.amount >= 0 ? "positive" : "negative"}">
                  ${formatPoints(tx.amount)}
                </td>
                <td>${formatPoints(tx.balanceAfter)}</td>
                <td class="overflow-wrap">${tx.source}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
      <loy-pagination page=${this.data.page} .totalPages=${this.data.totalPages}></loy-pagination>
    `;
  }
}
